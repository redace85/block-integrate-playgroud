#!/usr/bin/env node
'use strict';

// Transfer Amulet (Canton coin) between internal (validator-hosted) parties.
//
// Uses the Validator Wallet API: POST /v0/wallet/transfer-preapproval/send
// (userAuth JWT sub = sender's user ID).  The wallet service resolves AmuletRules
// and all required contracts internally — no manual contract disclosure needed.
//
// Prerequisite: receiver must have a TransferPreapproval already created.
//   Run: node pre-inter.js <receiver_key>   (once per receiver)
//
// Usage:
//   node trans-inter.js <receiver_party_id> [amount] [description]  — transfer
//   node trans-inter.js --query-utxos [sender_party_id]             — query UTXOs only
//
// Sender defaults to party-ids.json "inlabelX2" → "internal1" → "local1".
//
// Env vars:
//   VALIDATOR_API    Validator REST API base URL (default: http://10.108.2.200:5003/api/validator)
//   PARTICIPANT      Ledger API base URL (default: http://10.108.2.200:7575)
//   SENDER_USER_ID   Daml ledger-API user name for the sender (default: party-id prefix)
//   HMAC_SECRET      HMAC signing secret (default: "unsafe")
//   HMAC_AUDIENCE    JWT audience for Validator/Wallet API (default: https://validator.example.com)
//   LEDGER_AUDIENCE  JWT audience for Ledger API (default: https://canton.network.global)

const crypto = require('node:crypto');
const fs     = require('node:fs');
const path   = require('node:path');

// ─── Config ───────────────────────────────────────────────────────────────────

const VALIDATOR_API  = process.env.VALIDATOR_API  || 'http://10.108.2.200:5003/api/validator';
const PARTICIPANT    = process.env.PARTICIPANT    || 'http://10.108.2.200:7575';
const PARTY_IDS_FILE = path.join(__dirname, 'party-ids.json');

const HMAC_SECRET      = process.env.HMAC_SECRET      || 'unsafe';
const HMAC_AUDIENCE    = process.env.HMAC_AUDIENCE    || 'https://validator.example.com';
const LEDGER_AUDIENCE  = process.env.LEDGER_AUDIENCE  || 'https://canton.network.global';

const AMULET_TEMPLATE_SUFFIX = ':Splice.Amulet:Amulet';
const WILDCARD_FILTER = {
  cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }],
};

// ─── CLI args ─────────────────────────────────────────────────────────────────

const QUERY_ONLY      = process.argv[2] === '--query-utxos';
const RECEIVER_ARG    = QUERY_ONLY ? null : process.argv[2];
const AMOUNT_ARG      = QUERY_ONLY ? null : parseFloat(process.argv[3] || '9');
const DESCRIPTION_ARG = QUERY_ONLY ? null : (process.argv[4] || null);
const SENDER_OVERRIDE = QUERY_ONLY ? process.argv[3] : null;

// ─── JWT builders ─────────────────────────────────────────────────────────────

function buildUserToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ sub: userId, iat: now, exp: now + 86400, aud: HMAC_AUDIENCE })).toString('base64url');
  const s = crypto.createHmac('sha256', HMAC_SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

function buildLedgerToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ sub: userId, iat: now, exp: now + 86400, aud: LEDGER_AUDIENCE })).toString('base64url');
  const s = crypto.createHmac('sha256', HMAC_SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function httpGet(url, token) {
  const resp = await fetch(url, {
    headers: { accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`GET ${url} → ${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function httpPost(url, body, token) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`POST ${url} → ${resp.status} ${await resp.text()}`);
  const text = await resp.text();
  return text ? JSON.parse(text) : {};
}

// ─── UTXO query (Ledger API) ──────────────────────────────────────────────────

async function queryUtxos(partyId, ledgerToken) {
  const data = await httpGet(`${PARTICIPANT}/v2/state/ledger-end`, ledgerToken);
  const activeAtOffset = data.offset;
  console.log(`  Ledger end offset : ${activeAtOffset}`);

  const results = await httpPost(`${PARTICIPANT}/v2/state/active-contracts`, {
    filter: { filtersByParty: { [partyId]: WILDCARD_FILTER } },
    verbose: true,
    activeAtOffset,
  }, ledgerToken);

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
    console.log('');
  }
  const total = utxos.reduce((s, u) => s + (u.amount ?? 0), 0);
  console.log(`  Total balance: ${total.toFixed(10)} Amulet`);
}

// ─── Transfer via Wallet API ──────────────────────────────────────────────────
//
// The wallet service handles AmuletRules resolution internally.
// userAuth JWT (sub = sender's user ID) authorises the send on behalf of that user.

async function transfer(userId, senderPartyId, receiverPartyId, amount, description) {
  const userToken   = buildUserToken(userId);
  const ledgerToken = buildLedgerToken(userId);

  console.log('\n[1] Querying sender UTXOs (balance check)...');
  const utxos = await queryUtxos(senderPartyId, ledgerToken);
  printUtxos(utxos, 'Sender UTXOs');

  const total = utxos.reduce((s, u) => s + (u.amount ?? 0), 0);
  if (total < amount) {
    throw new Error(`Insufficient balance: have ${total.toFixed(10)}, need ${amount}`);
  }

  console.log('\n[2] Sending via Wallet API (transfer-preapproval/send)...');
  console.log(`  Sender   : ${senderPartyId}`);
  console.log(`  Receiver : ${receiverPartyId}`);
  console.log(`  Amount   : ${amount} Amulet`);

  const dedupId = `trans-inter-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const body = {
    receiver_party_id: receiverPartyId,
    amount:            String(amount),
    deduplication_id:  dedupId,
  };
  if (description) body.description = description;

  const result = await httpPost(
    `${VALIDATOR_API}/v0/wallet/transfer-preapproval/send`,
    body,
    userToken,
  );

  return { result, dedupId };
}

// ─── Load sender party ID ─────────────────────────────────────────────────────

function loadSenderPartyId() {
  if (SENDER_OVERRIDE) return SENDER_OVERRIDE;
  if (fs.existsSync(PARTY_IDS_FILE)) {
    const saved = JSON.parse(fs.readFileSync(PARTY_IDS_FILE, 'utf8'));
    if (saved.inter_user)  return saved.inter_user;
    if (saved.inlabelX2)  return saved.inlabelX2;
    if (saved.local1)     return saved.local1;
  }
  throw new Error(`No sender party ID — pass as arg or set inlabelX2/internal1 in ${PARTY_IDS_FILE}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Validator API : ${VALIDATOR_API}`);
  console.log(`Ledger API    : ${PARTICIPANT}`);

  const senderPartyId = loadSenderPartyId();
  const userId = process.env.SENDER_USER_ID || senderPartyId.split('::')[0];

  console.log(`Sender party  : ${senderPartyId}`);
  console.log(`Sender user   : ${userId}`);

  if (QUERY_ONLY) {
    const ledgerToken = buildLedgerToken(userId);
    console.log(`\n=== UTXO query for ${senderPartyId} ===`);
    const utxos = await queryUtxos(senderPartyId, ledgerToken);
    printUtxos(utxos, 'UTXOs');
    return;
  }

  if (!RECEIVER_ARG) {
    console.error('Usage: node trans-inter.js <receiver_party_id> [amount]');
    console.error('       node trans-inter.js --query-utxos [sender_party_id]');
    process.exit(1);
  }

  console.log(`\n=== Internal-party Amulet transfer ===`);
  console.log(`  Sender      : ${senderPartyId}`);
  console.log(`  Receiver    : ${RECEIVER_ARG}`);
  console.log(`  Amount      : ${AMOUNT_ARG} Amulet`);
  if (DESCRIPTION_ARG) console.log(`  Description : ${DESCRIPTION_ARG}`);

  const { result, dedupId } = await transfer(userId, senderPartyId, RECEIVER_ARG, AMOUNT_ARG, DESCRIPTION_ARG);

  console.log('\nTransfer submitted!');
  console.log(`  deduplication_id : ${dedupId}`);
  if (result && Object.keys(result).length > 0) {
    console.log('  response:', JSON.stringify(result, null, 2));
  }
}

main().catch(err => {
  console.error('\nError:', err.message ?? err);
  process.exit(1);
});
