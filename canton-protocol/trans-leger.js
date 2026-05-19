#!/usr/bin/env node
'use strict';

// External-party Canton coin (Amulet) transfer via Ledger API interactive submission.
//
// NOTE: This approach exercises AmuletRules_Transfer directly via the JSON Ledger API.
// It requires the AmuletRules contract to be visible on the participant — which only works
// when the participant hosts the DSO node as well. On a standalone validator participant
// the AmuletRules contract lives on the DSO node and is NOT accessible here, causing a
// CONTRACT_NOT_FOUND error. Use trans.js (Validator API / ExternalPartyAmuletRules) instead.
//
// Usage:
//   node trans-leger.js <receiver_party_id> [amount]     — transfer
//   node trans-leger.js --query-utxos [sender_party_id]  — query sender UTXOs only
//
// Sender defaults to party-ids.json local1 (external party, private_key.der).

const crypto = require('node:crypto');
const fs     = require('node:fs');
const path   = require('node:path');

// ─── Config ───────────────────────────────────────────────────────────────────

const GRPC_ENDPOINT = '10.108.2.200:5001';          // gRPC ledger gateway (reference)
const PARTICIPANT   = 'http://10.108.2.200:7575';   // HTTP JSON ledger API

const TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJhdWQiOiJodHRwczovL2NhbnRvbi5uZXR3b3JrLmdsb2JhbCIsInN1YiI6ImxlZGdlci1hcGktdXNlciJ9' +
  '.A0VZW69lWWNVsjZmDDpVvr1iQ_dJLga3f-K2bicdtsc';

const PRIVATE_KEY_FILE = path.join(__dirname, 'private_key.der');
const PARTY_IDS_FILE   = path.join(__dirname, 'party-ids.json');
const USER_ID          = 'ledger-api-user';

const AMULET_TEMPLATE_SUFFIX          = ':Splice.Amulet:Amulet';
const VALIDATOR_RIGHT_TEMPLATE_SUFFIX = ':Splice.Amulet:ValidatorRight';
const WILDCARD_FILTER = {
  cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }],
};

// ─── CLI args ─────────────────────────────────────────────────────────────────

const QUERY_ONLY      = process.argv[2] === '--query-utxos';
const RECEIVER_ARG    = QUERY_ONLY ? null : process.argv[2];
const AMOUNT_ARG      = QUERY_ONLY ? null : parseFloat(process.argv[3] || '9');
const SENDER_OVERRIDE = QUERY_ONLY ? process.argv[3] : null;

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function httpGet(url) {
  const resp = await fetch(url, {
    headers: { accept: 'application/json', Authorization: `Bearer ${TOKEN}` },
  });
  if (!resp.ok) throw new Error(`GET ${url} → ${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function httpPost(url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`POST ${url} → ${resp.status} ${await resp.text()}`);
  const text = await resp.text();
  return text ? JSON.parse(text) : {};
}

// ─── Ledger helpers ───────────────────────────────────────────────────────────

async function getLedgerEnd() {
  const data = await httpGet(`${PARTICIPANT}/v2/state/ledger-end`);
  return data.offset;
}

async function getSynchronizerId() {
  const data = await httpGet(`${PARTICIPANT}/v2/state/connected-synchronizers`);
  return data.connectedSynchronizers[0].synchronizerId;
}

// ─── UTXO query ───────────────────────────────────────────────────────────────

async function queryUtxos(partyId) {
  const activeAtOffset = await getLedgerEnd();
  console.log(`  Ledger end offset : ${activeAtOffset}`);

  const results = await httpPost(`${PARTICIPANT}/v2/state/active-contracts`, {
    filter: { filtersByParty: { [partyId]: WILDCARD_FILTER } },
    verbose: true,
    activeAtOffset,
  });

  const utxos = [];
  for (const entry of results) {
    const created = entry.contractEntry?.JsActiveContract?.createdEvent;
    if (!created?.templateId?.includes(AMULET_TEMPLATE_SUFFIX)) continue;
    const amount = created.createArgument?.amount?.initialAmount ?? null;
    utxos.push({
      contractId: created.contractId,
      templateId: created.templateId,
      amount: amount !== null ? parseFloat(amount) : null,
    });
  }

  utxos.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
  return utxos;
}

function printUtxos(utxos, label) {
  console.log(`\n  ${label} — ${utxos.length} UTXO(s):`);
  if (utxos.length === 0) { console.log('    (none)'); return; }
  for (const u of utxos) {
    console.log(`    contractId : ${u.contractId}`);
    console.log(`    amount     : ${u.amount !== null ? u.amount.toFixed(10) + ' Amulet' : '(unknown)'}`);
    console.log(`    template   : ${u.templateId}`);
    console.log('');
  }
  const total = utxos.reduce((s, u) => s + (u.amount ?? 0), 0);
  console.log(`  Total balance: ${total.toFixed(10)} Amulet`);
}

// Returns ValidatorRight contracts visible to partyIds, plus validator and DSO party IDs.
async function queryValidatorRights(partyIds) {
  const activeAtOffset = await getLedgerEnd();
  const filtersByParty = {};
  for (const p of partyIds) filtersByParty[p] = WILDCARD_FILTER;

  const results = await httpPost(`${PARTICIPANT}/v2/state/active-contracts`, {
    filter: { filtersByParty },
    verbose: true,
    activeAtOffset,
  });

  const rights = {};
  let validator = null;
  let dso = null;
  for (const entry of results) {
    const created = entry.contractEntry?.JsActiveContract?.createdEvent;
    if (!created?.templateId?.includes(VALIDATOR_RIGHT_TEMPLATE_SUFFIX)) continue;
    const user = created.createArgument?.user;
    if (user) rights[user] = created.contractId;
    if (!validator && created.createArgument?.validator) validator = created.createArgument.validator;
    if (!dso && created.createArgument?.dso) dso = created.createArgument.dso;
  }
  return { rights, validator, dso };
}

// Greedy UTXO selection: pick largest-first until amount is covered.
function selectUtxos(utxos, amount) {
  let collected = 0;
  const selected = [];
  for (const u of utxos) {
    if (collected >= amount) break;
    if (u.amount === null) continue;
    selected.push(u);
    collected += u.amount;
  }
  if (collected < amount) {
    throw new Error(`Insufficient balance: have ${collected.toFixed(10)}, need ${amount}`);
  }
  return { selected, totalInput: collected };
}

// ─── Discover AmuletRules + OpenMiningRound ───────────────────────────────────

async function discoverContextContracts() {
  const endOffset   = await getLedgerEnd();
  const startOffset = Math.max(0, parseInt(endOffset) - 5000);

  const txs = await httpPost(`${PARTICIPANT}/v2/updates/flats`, {
    beginExclusive: String(startOffset),
    endInclusive:   String(endOffset),
    filter: { filtersForAnyParty: WILDCARD_FILTER },
    verbose: true,
  });

  for (let i = txs.length - 1; i >= 0; i--) {
    const events = txs[i]?.update?.Transaction?.value?.events ?? [];
    for (const ev of events) {
      const arg = ev.ExercisedEvent?.choiceArgument;
      if (!arg) continue;
      const amuletRules = arg?.context?.amuletRules ?? arg?.amuletRules ?? null;
      const openMiningRound =
        arg?.context?.context?.openMiningRound ??
        arg?.context?.openMiningRound ??
        arg?.openMiningRound ?? null;
      if (amuletRules && openMiningRound) return { amuletRules, openMiningRound };
    }
  }
  throw new Error('Could not find AmuletRules/OpenMiningRound in recent transactions');
}

// ─── Key helpers ──────────────────────────────────────────────────────────────

function loadPrivateKey() {
  const der = fs.readFileSync(PRIVATE_KEY_FILE);
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

function getFingerprint(privateKey) {
  const pubDer = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(pubDer).digest('hex');
}

// ─── Interactive submission (external party signing) ──────────────────────────

async function submitAndWait(partyId, commands, synchronizerId, privateKey, fingerprint, readAs = []) {
  const commandId    = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const submissionId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const prepareResp = await httpPost(`${PARTICIPANT}/v2/interactive-submission/prepare`, {
    userId: USER_ID,
    commandId,
    synchronizerId,
    verboseHashing: false,
    actAs: [partyId],
    readAs,
    packageIdSelectionPreference: [],
    commands,
  });

  const { preparedTransaction, preparedTransactionHash, hashingSchemeVersion } = prepareResp;

  const hashBytes = Buffer.from(preparedTransactionHash, 'base64');
  const signature = crypto.sign(null, hashBytes, privateKey).toString('base64');

  return httpPost(`${PARTICIPANT}/v2/interactive-submission/executeAndWait`, {
    preparedTransaction,
    partySignatures: {
      signatures: [{
        party: partyId,
        signatures: [{
          format:               'SIGNATURE_FORMAT_CONCAT',
          signature,
          signedBy:             fingerprint,
          signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519',
        }],
      }],
    },
    deduplicationPeriod: { DeduplicationDuration: { value: { seconds: 300, nanos: 0 } } },
    submissionId,
    userId: USER_ID,
    hashingSchemeVersion,
  });
}

// ─── Transfer ─────────────────────────────────────────────────────────────────

async function transfer(senderPartyId, receiverPartyId, amount, ctx, synchronizerId, privateKey, fingerprint) {
  console.log('\n[2] Querying sender UTXOs...');
  const utxos = await queryUtxos(senderPartyId);
  printUtxos(utxos, 'Sender UTXOs');

  console.log(`\n[3] Selecting UTXOs to cover ${amount} Amulet (largest-first)...`);
  const { selected, totalInput } = selectUtxos(utxos, amount);
  console.log(`  Selected ${selected.length} UTXO(s), total input: ${totalInput.toFixed(10)} Amulet`);
  for (const u of selected) {
    console.log(`    + ${u.contractId}  (${u.amount.toFixed(10)} Amulet)`);
  }

  console.log('\n[3b] Querying ValidatorRight contracts for sender and receiver...');
  const { rights: validatorRights, validator, dso } = await queryValidatorRights([senderPartyId, receiverPartyId]);
  for (const [party, cid] of Object.entries(validatorRights)) {
    console.log(`  ${party} → ${cid}`);
  }
  if (validator) console.log(`  validator: ${validator}`);
  if (dso) console.log(`  dso:       ${dso}`);

  // Variant type InputAmulet must use {tag, value} encoding for the JSON Ledger API v2.
  const inputs = selected.map(u => ({ tag: 'InputAmulet', value: u.contractId }));

  console.log('\n[4] Submitting transfer via interactive submission...');
  console.log(`  AmuletRules    : ${ctx.amuletRules}`);
  console.log(`  OpenMiningRound: ${ctx.openMiningRound}`);
  console.log(`  Sender         : ${senderPartyId}`);
  console.log(`  Receiver       : ${receiverPartyId}`);
  console.log(`  Amount         : ${amount} Amulet`);

  // Derive template ID from the package prefix of the first Amulet UTXO.
  const packagePrefix       = selected[0].templateId.split(':')[0];
  const amuletRulesTemplateId = `${packagePrefix}:Splice.AmuletRules:AmuletRules`;

  // validator + DSO must be in readAs so the participant can resolve the AmuletRules contract.
  const readAs = [validator, dso].filter(Boolean);

  // Daml Map Party (ContractId ValidatorRight) is encoded as [[party, contractId], ...].
  return submitAndWait(senderPartyId, [{
    ExerciseCommand: {
      templateId:  amuletRulesTemplateId,
      contractId:  ctx.amuletRules,
      choice:      'AmuletRules_Transfer',
      choiceArgument: {
        transfer: {
          sender:   senderPartyId,
          provider: senderPartyId,
          inputs,
          outputs: [{
            receiver:         receiverPartyId,
            amount:           String(amount),
            receiverFeeRatio: '0.0',
            lock: null,
          }],
        },
        context: {
          openMiningRound:     ctx.openMiningRound,
          issuingMiningRounds: [],
          featuredAppRight:    null,
          validatorRights:     Object.entries(validatorRights),
        },
      },
    },
  }], synchronizerId, privateKey, fingerprint, readAs);
}

// ─── Load sender party ID ─────────────────────────────────────────────────────

function loadSenderPartyId() {
  if (SENDER_OVERRIDE) return SENDER_OVERRIDE;
  if (fs.existsSync(PARTY_IDS_FILE)) {
    const saved = JSON.parse(fs.readFileSync(PARTY_IDS_FILE, 'utf8'));
    if (saved.local1) return saved.local1;
  }
  throw new Error(`No sender party ID — pass it as an arg or set local1 in ${PARTY_IDS_FILE}`);
}

async function checkAmuletRulesAccess(dsoPartyId) {
  const offset = await getLedgerEnd();
  const results = await httpPost(`${PARTICIPANT}/v2/state/active-contracts`, {
    filter: { filtersByParty: { [dsoPartyId]: WILDCARD_FILTER } },
    verbose: true,
    activeAtOffset: offset,
  });

  return results.some(entry => {
    const templateId = entry.contractEntry?.JsActiveContract?.createdEvent?.templateId ?? '';
    return templateId.includes(':Splice.AmuletRules:AmuletRules');
  });
}


// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`gRPC endpoint : ${GRPC_ENDPOINT}  (reference)`);
  console.log(`Ledger API    : ${PARTICIPANT}`);

  const senderPartyId = loadSenderPartyId();

  if (QUERY_ONLY) {
    console.log(`\n=== UTXO query for ${senderPartyId} ===`);
    const utxos = await queryUtxos(senderPartyId);
    printUtxos(utxos, 'UTXOs');
    return;
  }

  if (!RECEIVER_ARG) {
    console.error('Usage: node trans-leger.js <receiver_party_id> [amount]');
    console.error('       node trans-leger.js --query-utxos [sender_party_id]');
    process.exit(1);
  }

  const receiverPartyId = RECEIVER_ARG;
  const amount          = AMOUNT_ARG;

  console.log(`\n=== External-party transfer (Ledger API) ===`);
  console.log(`  Sender   : ${senderPartyId}`);
  console.log(`  Receiver : ${receiverPartyId}`);
  console.log(`  Amount   : ${amount} Amulet`);

  const privateKey  = loadPrivateKey();
  const fingerprint = getFingerprint(privateKey);
  console.log(`  Key fingerprint: ${fingerprint}`);

  console.log('\n[1] Discovering context contracts and synchronizer ID...');
  const [ctx, synchronizerId] = await Promise.all([
    discoverContextContracts(),
    getSynchronizerId(),
  ]);
  console.log(`  AmuletRules    : ${ctx.amuletRules}`);
  console.log(`  OpenMiningRound: ${ctx.openMiningRound}`);
  console.log(`  SynchronizerId : ${synchronizerId}`);

  const result = await transfer(
    senderPartyId, receiverPartyId, amount,
    ctx, synchronizerId, privateKey, fingerprint,
  );

  const updateId = result.updateId ?? result.transaction?.updateId ?? JSON.stringify(result).slice(0, 120);
  console.log(`\nTransfer OK — updateId: ${updateId}`);
}

main().catch(err => {
  console.error('\nError:', err.message ?? err);
  process.exit(1);
});
