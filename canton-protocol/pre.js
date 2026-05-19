#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs     = require('node:fs');
const path   = require('node:path');

// ─── Config ───────────────────────────────────────────────────────────────────

const VALIDATOR_API = process.env.VALIDATOR_API || 'http://10.108.2.200:5003/api/validator';

function buildToken() {
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

const TOKEN = buildToken();

const PRIVATE_KEY_FILE = path.join(__dirname, 'test_pk.der');
const PARTY_IDS_FILE   = path.join(__dirname, 'party-ids.json');

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

const HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${TOKEN}`,
};

async function httpPost(url, body) {
  const resp = await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`POST ${url} → ${resp.status}: ${text}`);
  }
  return resp.json();
}

// ─── Key helpers ──────────────────────────────────────────────────────────────

function loadKeys() {
  const der        = fs.readFileSync(PRIVATE_KEY_FILE);
  const privateKey = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  // Ed25519 SPKI DER is 44 bytes; raw public key is the last 32 bytes
  const pubDer     = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const publicKeyHex = pubDer.slice(-32).toString('hex');
  return { privateKey, publicKeyHex };
}

// Sign a hex-encoded hash, return hex-encoded raw 64-byte signature (r || s)
function signHex(txHashHex, privateKey) {
  const hashBytes = Buffer.from(txHashHex, 'hex');
  return crypto.sign(null, hashBytes, privateKey).toString('hex');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Token : ${TOKEN}`);
  const partyIds       = JSON.parse(fs.readFileSync(PARTY_IDS_FILE, 'utf8'));
  const externalPartyId = process.argv[2] || partyIds.local1;

  console.log(`External party : ${externalPartyId}`);

  const { privateKey, publicKeyHex } = loadKeys();
  console.log(`Public key hex : ${publicKeyHex}`);

  // 1. Create ExternalPartySetupProposal (validator operator side)
  console.log('\n[1] Creating ExternalPartySetupProposal...');
  // const createResp = await httpPost(
  //   `${VALIDATOR_API}/v0/admin/external-party/setup-proposal`,
  //   { user_party_id: externalPartyId },
  // );
  // const contractId = createResp.contract_id;
  const contractId = "00ea1cbc6e419ab0c33e6e6598ff451269c2ea7f76119b2407f71fbeaf499baec9ca121220b438253344dcabf41a07931368c1badb2f492bca535b77f9f567ae42ed9944e4"
  console.log(`    contract_id: ${contractId}`);

  // 2. Prepare the acceptance transaction
  console.log('\n[2] Preparing accept transaction...');
  const prepareResp = await httpPost(
    `${VALIDATOR_API}/v0/admin/external-party/setup-proposal/prepare-accept`,
    { contract_id: contractId, user_party_id: externalPartyId },
  );
  const { transaction, tx_hash } = prepareResp;
  console.log(`    tx_hash: ${tx_hash}`);

  // 3. Sign tx_hash with external party's ED25519 key
  console.log('\n[3] Signing tx_hash...');
  const signed_tx_hash = signHex(tx_hash, privateKey);
  console.log(`    signed_tx_hash: ${signed_tx_hash}`);

  // 4. Submit signed acceptance → creates TransferPreapproval contract
  console.log('\n[4] Submitting accept...');
  const subreq= {
      submission: {
        party_id:      externalPartyId,
        transaction,
        signed_tx_hash,
        public_key:    publicKeyHex,
      },
    };
  console.log(JSON.stringify(subreq));
  // const submitResp = await httpPost(
  //   `${VALIDATOR_API}/v0/admin/external-party/setup-proposal/submit-accept`,
  //   subreq,
  // );

  console.log('\nTransferPreapproval created!');
  console.log(`  transfer_preapproval_contract_id : ${submitResp.transfer_preapproval_contract_id}`);
  console.log(`  update_id                        : ${submitResp.update_id}`);
}

main().catch(err => {
  console.error('\nError:', err.message ?? err);
  process.exit(1);
});
