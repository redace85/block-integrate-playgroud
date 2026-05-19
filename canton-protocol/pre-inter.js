#!/usr/bin/env node
'use strict';

// Create a TransferPreapproval for an internal (validator-hosted) party.
//
// Mirrors pre.js (ExternalPartySetupProposal → TransferPreapproval) but for
// internal parties. The key difference:
//
//   External (pre.js):
//     prepare-accept → client signs tx_hash with ED25519 key → submit-accept
//
//   Internal (this file):
//     Admin creates proposal → Ledger API submit-and-wait exercises Accept choice
//     No client-side signing: the participant holds the party's key and signs automatically.
//
// Flow:
//   1. Admin creates ExternalPartySetupProposal
//      POST /v0/admin/external-party/setup-proposal  (adminAuth)
//   2. Discover the proposal templateId via ACS or recent updates
//   3. Internal party exercises ExternalPartySetupProposal_Accept via submit-and-wait
//      → TransferPreapproval contract created
//
// Usage:
//   node pre-inter.js [party_key]
//   party_key : key in party-ids.json for the internal party (default: "internal1")
//               Falls back to "local1" if "internal1" is absent.
//
// Env vars:
//   VALIDATOR_API    Validator REST API base URL (default: http://10.108.2.200:5003/api/validator)
//   PARTICIPANT      Ledger API base URL         (default: http://10.108.2.200:7575)
//   SENDER_USER_ID   Daml ledger-API user name   (default: prefix before "::" in party ID)
//   HMAC_SECRET      HMAC signing secret         (default: unsafe)
//   HMAC_SUBJECT     Admin sub claim             (default: administrator)
//   HMAC_AUDIENCE    Validator API JWT audience  (default: https://validator.example.com)
//   LEDGER_AUDIENCE  Ledger API JWT audience     (default: https://canton.network.global)

const crypto = require('node:crypto');
const fs     = require('node:fs');
const path   = require('node:path');

// ─── Config ───────────────────────────────────────────────────────────────────

const VALIDATOR_API  = process.env.VALIDATOR_API  || 'http://10.108.2.200:5003/api/validator';
const PARTICIPANT    = process.env.PARTICIPANT    || 'http://10.108.2.200:7575';
const PARTY_IDS_FILE = path.join(__dirname, 'party-ids.json');

const HMAC_SECRET        = process.env.HMAC_SECRET       || 'unsafe';
const HMAC_SUBJECT       = process.env.HMAC_SUBJECT      || 'administrator';
const HMAC_AUDIENCE_VAL  = process.env.HMAC_AUDIENCE     || 'https://validator.example.com';
const HMAC_AUDIENCE_LED  = process.env.LEDGER_AUDIENCE   || 'https://canton.network.global';

const SETUP_PROPOSAL_SUFFIX = 'ExternalPartySetupProposal';
const WILDCARD_FILTER = {
  cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }],
};

// ─── JWT builders ─────────────────────────────────────────────────────────────

// adminAuth — for validator API endpoints
function buildAdminToken() {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ sub: HMAC_SUBJECT, iat: now, exp: now + 86400, aud: HMAC_AUDIENCE_VAL })).toString('base64url');
  const s = crypto.createHmac('sha256', HMAC_SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

// userAuth — for Ledger API (sub = internal party's user name)
function buildUserToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ sub: userId, iat: now, exp: now + 86400, aud: HMAC_AUDIENCE_LED })).toString('base64url');
  const s = crypto.createHmac('sha256', HMAC_SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function httpPost(url, body, token) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`POST ${url} → ${resp.status}: ${text}`);
  }
  const text = await resp.text();
  return text ? JSON.parse(text) : {};
}

async function httpGet(url, token) {
  const resp = await fetch(url, {
    headers: { accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`GET ${url} → ${resp.status} ${await resp.text()}`);
  return resp.json();
}

// ─── Ledger API helpers ───────────────────────────────────────────────────────

async function getLedgerEnd(ledgerToken) {
  const data = await httpGet(`${PARTICIPANT}/v2/state/ledger-end`, ledgerToken);
  return data.offset;
}

async function getSynchronizerId(ledgerToken) {
  const data = await httpGet(`${PARTICIPANT}/v2/state/connected-synchronizers`, ledgerToken);
  return data.connectedSynchronizers[0].synchronizerId;
}

// ─── Proposal contract discovery ─────────────────────────────────────────────

// Search ACS for the ExternalPartySetupProposal contract visible to partyId.
async function findProposalInAcs(partyId, targetContractId, ledgerToken) {
  const activeAtOffset = await getLedgerEnd(ledgerToken);
  const results = await httpPost(`${PARTICIPANT}/v2/state/active-contracts`, {
    filter: { filtersByParty: { [partyId]: WILDCARD_FILTER } },
    verbose: true,
    activeAtOffset,
  }, ledgerToken);

  for (const entry of results) {
    const created = entry.contractEntry?.JsActiveContract?.createdEvent;
    if (!created) continue;
    // Match by contract ID if we know it; otherwise fall back to template suffix
    if (targetContractId) {
      if (created.contractId === targetContractId) return created;
    } else if (created.templateId?.includes(SETUP_PROPOSAL_SUFFIX)) {
      return created;
    }
  }
  return null;
}

// Scan recent updates between two ledger offsets to find a created event.
async function findProposalInUpdates(targetContractId, beginOffset, endOffset, ledgerToken) {
  if (parseInt(endOffset) <= parseInt(beginOffset)) return null;
  const txs = await httpPost(`${PARTICIPANT}/v2/updates/flats`, {
    beginExclusive: String(beginOffset),
    endInclusive:   String(endOffset),
    filter: { filtersForAnyParty: WILDCARD_FILTER },
    verbose: true,
  }, ledgerToken);

  for (const tx of txs) {
    const events = tx?.update?.Transaction?.value?.events ?? [];
    for (const ev of events) {
      const created = ev.CreatedEvent?.value ?? ev.CreatedEvent;
      if (!created) continue;
      if (targetContractId && created.contractId === targetContractId) return created;
      if (!targetContractId && created.templateId?.includes(SETUP_PROPOSAL_SUFFIX)) return created;
    }
  }
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const partyKey = process.argv[2] || 'internal1';

  const partyIds = JSON.parse(fs.readFileSync(PARTY_IDS_FILE, 'utf8'));
  const internalPartyId = partyIds[partyKey] ?? partyIds.local1;
  if (!internalPartyId) {
    throw new Error(`No party ID found for key "${partyKey}" in ${PARTY_IDS_FILE}`);
  }
  const userId = process.env.SENDER_USER_ID || internalPartyId.split('::')[0];

  const adminToken = buildAdminToken();
  const userToken  = buildUserToken(userId);

  console.log(`Validator API   : ${VALIDATOR_API}`);
  console.log(`Participant     : ${PARTICIPANT}`);
  console.log(`Internal party  : ${internalPartyId}`);
  console.log(`User ID         : ${userId}`);
  console.log(`Admin sub       : ${HMAC_SUBJECT}`);

  // ── Step 1: Admin creates ExternalPartySetupProposal ─────────────────────
  console.log('\n[1] Creating ExternalPartySetupProposal (adminAuth)...');
  const ledgerEndBefore = await getLedgerEnd(userToken);

  const createResp = await httpPost(
    `${VALIDATOR_API}/v0/admin/external-party/setup-proposal`,
    { user_party_id: internalPartyId },
    adminToken,
  );
  const contractId = createResp.contract_id;
  console.log(`    contract_id : ${contractId}`);

  // ── Step 2: Discover proposal templateId ─────────────────────────────────
  console.log('\n[2] Looking up proposal contract (templateId)...');

  // Brief wait for ledger propagation
  await new Promise(r => setTimeout(r, 2000));
  const ledgerEndAfter = await getLedgerEnd(userToken);

  let proposal = await findProposalInAcs(internalPartyId, contractId, userToken);
  if (!proposal) {
    // Fallback: scan recent updates visible to any party
    console.log('    Not found in ACS — scanning recent updates...');
    proposal = await findProposalInUpdates(contractId, ledgerEndBefore, ledgerEndAfter, userToken);
  }
  if (!proposal) {
    throw new Error(
      'ExternalPartySetupProposal not visible. ' +
      'The party may not be a stakeholder yet or the ledger offset has not caught up.',
    );
  }
  console.log(`    templateId  : ${proposal.templateId}`);
  console.log(`    contractId  : ${proposal.contractId}`);

  // ── Step 3: Get synchronizer ID ───────────────────────────────────────────
  const synchronizerId = await getSynchronizerId(userToken);
  console.log(`    synchronizerId : ${synchronizerId}`);

  // ── Step 4: Exercise Accept via submit-and-wait ───────────────────────────
  //
  // For internal parties the participant holds the signing key. submit-and-wait
  // authorises and signs on behalf of the party automatically — no client-side
  // ED25519 operation needed (contrast with pre.js signHex + public_key).
  console.log('\n[3] Exercising ExternalPartySetupProposal_Accept via submit-and-wait...');
  const commandId = `pre-inter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const result = await httpPost(`${PARTICIPANT}/v2/commands/submit-and-wait`, {
    userId,
    commandId,
    actAs:           [internalPartyId],
    readAs:          [],
    synchronizerId,
    commands: [{
      ExerciseCommand: {
        templateId:     proposal.templateId,
        contractId:     proposal.contractId,
        choice:         'ExternalPartySetupProposal_Accept',
        choiceArgument: {},
      },
    }],
    deduplicationPeriod: { DeduplicationDuration: { value: { seconds: 300, nanos: 0 } } },
  }, userToken);

  const updateId = result.updateId ?? result.transaction?.updateId ?? JSON.stringify(result).slice(0, 80);

  console.log('\nTransferPreapproval created!');
  console.log(`  Internal party : ${internalPartyId}`);
  console.log(`  updateId       : ${updateId}`);
}

main().catch(err => {
  console.error('\nError:', err.message ?? err);
  process.exit(1);
});
