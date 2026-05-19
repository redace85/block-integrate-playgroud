#!/usr/bin/env node
'use strict';

// Transfer from internal hosted party to external party via TransferPreapproval.
// Requires: receiver already has a TransferPreapproval contract (run pre.js first).
//
// Usage: node trans.js <receiver_party_id> [amount]
// e.g.:  node trans.js local-dev-t1::1220... 10

const crypto = require('node:crypto');

// ─── Config ───────────────────────────────────────────────────────────────────

const VALIDATOR_API  = process.env.VALIDATOR_API  || 'http://10.108.2.200:5003/api/validator';
const SENDER_PARTY   = 'cactus-devwallet-1::1220369880c8a140cdac262ea989407de2c6d5578fdaf38511d7d5de58057fd3615c';
const RECEIVER_PARTY = process.argv[2];
const AMOUNT         = process.argv[3] || '10';

// ─── Token ────────────────────────────────────────────────────────────────────

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
  const text = await resp.text();
  return text ? JSON.parse(text) : {};
}

async function httpGet(url) {
  const resp = await fetch(url, { method: 'GET', headers: HEADERS });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GET ${url} → ${resp.status}: ${text}`);
  }
  return resp.json();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!RECEIVER_PARTY) {
    console.error('Usage: node cac-send.js <receiver_party_id> [amount]');
    process.exit(1);
  }

  console.log(`Sender  : ${SENDER_PARTY}`);
  console.log(`Receiver: ${RECEIVER_PARTY}`);
  console.log(`Amount  : ${AMOUNT}`);

  // Verify TransferPreapproval exists for receiver
  console.log('\n[1] Verifying TransferPreapproval for receiver...');
  const preapproval = await httpGet(
    `${VALIDATOR_API}/v0/admin/transfer-preapprovals/by-party/${encodeURIComponent(RECEIVER_PARTY)}`,
  );
  const contractId = preapproval.transfer_preapproval?.contract?.contract_id;
  console.log(`    contract_id: ${contractId}`);

  // Send via preapproval (userAuth — sender is the wallet user)
  console.log('\n[2] Sending via transfer-preapproval...');
  const dedupId = `trans-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const result = await httpPost(
    `${VALIDATOR_API}/v0/wallet/transfer-preapproval/send`,
    {
      receiver_party_id: RECEIVER_PARTY,
      amount:            AMOUNT,
      deduplication_id:  dedupId,
    },
  );

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
