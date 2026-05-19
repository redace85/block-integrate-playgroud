#!/usr/bin/env node
'use strict';

// External-party Canton coin (Amulet) transfer with UTXO query and selection.
//
// Flow (ExternalPartyAmuletRules):
//   1. Query sender UTXOs (display + balance check)
//   2. Get TransferCommand nonce from ACS
//   3. Validator API prepare-send  → tx_hash
//   4. External party signs tx_hash with ED25519 private key
//   5. Validator API submit-send   → TransferCommand created; DSO automation executes it
//
// Usage:
//   node trans.js <receiver_party_id> [amount]     — transfer
//   node trans.js --query-utxos [sender_party_id]  — query sender UTXOs only
//
// Sender defaults to party-ids.json local1 (external party, private_key.der).

const crypto = require('node:crypto');
const fs     = require('node:fs');
const path   = require('node:path');

// ─── Config ───────────────────────────────────────────────────────────────────

const GRPC_ENDPOINT  = '10.108.2.200:5001';                          // gRPC ledger gateway (reference)
const PARTICIPANT    = 'http://10.108.2.200:7575';                   // HTTP JSON ledger API
const VALIDATOR_API  = 'http://10.108.2.200:5003/api/validator';     // Validator REST API

const PRIVATE_KEY_FILE = path.join(__dirname, 'test_pk.der');
const PARTY_IDS_FILE   = path.join(__dirname, 'party-ids.json');

const AMULET_TEMPLATE_SUFFIX          = ':Splice.Amulet:Amulet';
const TRANSFER_CMD_COUNTER_SUFFIX     = ':Splice.ExternalPartyAmuletRules:TransferCommandCounter';
const WILDCARD_FILTER = {
  cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }],
};

// ─── CLI args ─────────────────────────────────────────────────────────────────

const QUERY_ONLY      = process.argv[2] === '--query-utxos';
const RECEIVER_ARG    = QUERY_ONLY ? null : process.argv[2];
const AMOUNT_ARG      = QUERY_ONLY ? null : parseFloat(process.argv[3] || '9');
const SENDER_OVERRIDE = QUERY_ONLY ? process.argv[3] : null;

// ─── Token builders ───────────────────────────────────────────────────────────

// Ledger API — pre-signed JWT from the gRPC reference file
const LEDGER_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJhdWQiOiJodHRwczovL2NhbnRvbi5uZXR3b3JrLmdsb2JhbCIsInN1YiI6ImxlZGdlci1hcGktdXNlciJ9' +
  '.A0VZW69lWWNVsjZmDDpVvr1iQ_dJLga3f-K2bicdtsc';

// Validator API — HMAC-signed JWT (adminAuth)
function buildValidatorToken() {
  if (process.env.VALIDATOR_TOKEN) return process.env.VALIDATOR_TOKEN;
  const secret   = process.env.HMAC_SECRET   || 'unsafe';
  const audience = process.env.HMAC_AUDIENCE || 'https://validator.example.com';
  const sub      = process.env.HMAC_SUBJECT  || 'administrator';
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ sub, iat: now, exp: now + 86400, aud: audience })).toString('base64url');
  const s = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
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

// ─── Ledger API helpers ───────────────────────────────────────────────────────

async function getLedgerEnd() {
  const data = await httpGet(`${PARTICIPANT}/v2/state/ledger-end`, LEDGER_TOKEN);
  return data.offset;
}

async function queryAcs(partyId) {
  const activeAtOffset = await getLedgerEnd();
  console.log(`  Ledger end offset : ${activeAtOffset}`);
  return httpPost(`${PARTICIPANT}/v2/state/active-contracts`, {
    filter: { filtersByParty: { [partyId]: WILDCARD_FILTER } },
    verbose: true,
    activeAtOffset,
  }, LEDGER_TOKEN);
}

// ─── UTXO query ───────────────────────────────────────────────────────────────

async function queryUtxos(partyId) {
  const results = await queryAcs(partyId);
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

// Greedy UTXO selection: pick largest-first until amount is covered (balance validation only).
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

// ─── Nonce query ──────────────────────────────────────────────────────────────

// Reads next nonce for the sender from TransferCommandCounter in the DSO ACS.
// Returns 0 if no counter exists yet (first-ever command for this party).
async function getNextNonce(senderPartyId) {
  const DSO_PARTY = await getDsoParty(senderPartyId);
  if (!DSO_PARTY) return 0;

  const activeAtOffset = await getLedgerEnd();
  const results = await httpPost(`${PARTICIPANT}/v2/state/active-contracts`, {
    filter: { filtersByParty: { [DSO_PARTY]: WILDCARD_FILTER } },
    verbose: true,
    activeAtOffset,
  }, LEDGER_TOKEN);

  for (const entry of results) {
    const created = entry.contractEntry?.JsActiveContract?.createdEvent;
    if (!created?.templateId?.includes(TRANSFER_CMD_COUNTER_SUFFIX)) continue;
    if (created.createArgument?.sender === senderPartyId) {
      return parseInt(created.createArgument.nextNonce ?? '0', 10);
    }
  }
  return 0;
}

async function getDsoParty(senderPartyId) {
  const results = await queryAcs(senderPartyId);
  for (const entry of results) {
    const created = entry.contractEntry?.JsActiveContract?.createdEvent;
    if (created?.createArgument?.dso) return created.createArgument.dso;
  }
  return null;
}

// ─── Key helpers ──────────────────────────────────────────────────────────────

function loadKeys() {
  const der = fs.readFileSync(PRIVATE_KEY_FILE);
  const privateKey = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const pubDer     = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const publicKeyHex = pubDer.slice(-32).toString('hex');
  return { privateKey, publicKeyHex };
}

function signHex(txHashHex, privateKey) {
  return crypto.sign(null, Buffer.from(txHashHex, 'hex'), privateKey).toString('hex');
}

// ─── Transfer via Validator API ───────────────────────────────────────────────

async function transfer(senderPartyId, receiverPartyId, amount) {
  const validatorToken = buildValidatorToken();
  const { privateKey, publicKeyHex } = loadKeys();
  console.log(`  Public key hex : ${publicKeyHex}`);

  // Step 1: query UTXOs for display and balance validation
  console.log('\n[1] Querying sender UTXOs...');
  const utxos = await queryUtxos(senderPartyId);
  printUtxos(utxos, 'Sender UTXOs');

  console.log(`\n[2] Validating balance (greedy selection, largest-first)...`);
  const { selected, totalInput } = selectUtxos(utxos, amount);
  console.log(`  Sufficient balance: ${totalInput.toFixed(10)} Amulet covers ${amount} Amulet`);
  console.log(`  Would consume ${selected.length} UTXO(s):`);
  for (const u of selected) {
    console.log(`    ${u.contractId}  (${u.amount.toFixed(10)} Amulet)`);
  }

  // Step 2: get nonce
  console.log('\n[3] Reading TransferCommandCounter nonce...');
  const nonce = await getNextNonce(senderPartyId);
  console.log(`  nonce: ${nonce}`);

  // Step 3: prepare TransferCommand via Validator API
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  console.log('\n[4] Calling prepare-send...');
  const prepareResp = await httpPost(
    `${VALIDATOR_API}/v0/admin/external-party/transfer-preapproval/prepare-send`,
    {
      sender_party_id:   senderPartyId,
      receiver_party_id: receiverPartyId,
      amount,
      expires_at:        expiresAt,
      nonce,
      verbose_hashing:   false,
    },
    validatorToken,
  );
  const { transaction, tx_hash, transfer_command_contract_id_prefix } = prepareResp;
  console.log(`  tx_hash                           : ${tx_hash}`);
  console.log(`  transfer_command_contract_id_prefix: ${transfer_command_contract_id_prefix}`);

  // Step 4: external party signs tx_hash
  console.log('\n[5] Signing tx_hash with ED25519 private key...');
  const signed_tx_hash = signHex(tx_hash, privateKey);
  console.log(`  signed_tx_hash: ${signed_tx_hash}`);

  // Step 5: submit to create TransferCommand; DSO automation executes the actual transfer
  console.log('\n[6] Submitting signed transaction (submit-send)...');
  const submitResp = await httpPost(
    `${VALIDATOR_API}/v0/admin/external-party/transfer-preapproval/submit-send`,
    {
      submission: {
        party_id:      senderPartyId,
        transaction,
        signed_tx_hash,
        public_key:    publicKeyHex,
      },
    },
    validatorToken,
  );
  return submitResp;
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`gRPC endpoint  : ${GRPC_ENDPOINT}  (reference)`);
  console.log(`Ledger API     : ${PARTICIPANT}`);
  console.log(`Validator API  : ${VALIDATOR_API}`);

  const senderPartyId = loadSenderPartyId();

  if (QUERY_ONLY) {
    console.log(`\n=== UTXO query for ${senderPartyId} ===`);
    const utxos = await queryUtxos(senderPartyId);
    printUtxos(utxos, 'UTXOs');
    return;
  }

  if (!RECEIVER_ARG) {
    console.error('Usage: node trans.js <receiver_party_id> [amount]');
    console.error('       node trans.js --query-utxos [sender_party_id]');
    process.exit(1);
  }

  const receiverPartyId = RECEIVER_ARG;
  const amount          = AMOUNT_ARG;

  console.log(`\n=== External-party transfer ===`);
  console.log(`  Sender   : ${senderPartyId}`);
  console.log(`  Receiver : ${receiverPartyId}`);
  console.log(`  Amount   : ${amount} Amulet`);

  const result = await transfer(senderPartyId, receiverPartyId, amount);

  console.log('\nTransferCommand created — DSO automation will execute the transfer.');
  if (result && Object.keys(result).length > 0) {
    console.log('  response:', JSON.stringify(result, null, 2));
  }
}

main().catch(err => {
  console.error('\nError:', err.message ?? err);
  process.exit(1);
});
