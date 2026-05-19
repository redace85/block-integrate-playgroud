#!/usr/bin/env node
'use strict';

// Register an internal (validator-hosted) party via the Splice Validator API.
// Internal parties have their signing keys managed by the validator participant node.
//
// Two modes:
//   self-register (default): POST /v0/register  (userAuth, JWT sub = user_id)
//     → party is created and wallet initialized for that user
//   admin-create  (--admin):  POST /v0/admin/users (adminAuth, JWT sub = "administrator")
//     → operator creates a party on behalf of another user
//
// Usage:
//   node internal_part.js [user_id] [key_name]
//   node internal_part.js --admin [user_id] [key_name]
//
//   user_id  : Daml ledger-API user name (default: "internal-user-1")
//   key_name : key to store party_id under in party-ids.json (default: "internal1")
//
// Env vars:
//   VALIDATOR_API    Validator REST API base URL (default: http://10.108.2.200:5003/api/validator)
//   HMAC_SECRET      HMAC signing secret          (default: "unsafe")
//   HMAC_AUDIENCE    JWT audience for validator   (default: "https://validator.example.com")
//   HMAC_ADMIN_SUB   Admin user sub claim         (default: "administrator")

const crypto = require('node:crypto');
const fs     = require('node:fs');
const path   = require('node:path');

// ─── Config ───────────────────────────────────────────────────────────────────

const VALIDATOR_API  = process.env.VALIDATOR_API  || 'http://10.108.2.200:5003/api/validator';
const PARTY_IDS_FILE = path.join(__dirname, 'party-ids.json');

const HMAC_SECRET   = process.env.HMAC_SECRET   || 'unsafe';
const HMAC_AUDIENCE = process.env.HMAC_AUDIENCE || 'https://validator.example.com';
const HMAC_ADMIN_SUB = process.env.HMAC_ADMIN_SUB || 'administrator';

// ─── CLI args ─────────────────────────────────────────────────────────────────

const ADMIN_MODE = process.argv[2] === '--admin';
const userId     = (ADMIN_MODE ? process.argv[3] : process.argv[2]) || 'internal-user-1';
const keyName    = (ADMIN_MODE ? process.argv[4] : process.argv[3]) || 'internal1';

// ─── JWT builder ──────────────────────────────────────────────────────────────

function buildToken(sub) {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ sub, iat: now, exp: now + 86400, aud: HMAC_AUDIENCE })).toString('base64url');
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Validator API : ${VALIDATOR_API}`);
  console.log(`Mode          : ${ADMIN_MODE ? 'admin-create' : 'self-register'}`);
  console.log(`User ID       : ${userId}`);
  console.log(`Key name      : ${keyName}`);

  let partyId;

  if (ADMIN_MODE) {
    // adminAuth: sub = operator's ledger-API user name (typically "administrator")
    const token = buildToken(HMAC_ADMIN_SUB);
    console.log(`Admin sub     : ${HMAC_ADMIN_SUB}`);
    console.log(`\n[1] Admin-creating party for user "${userId}"...`);
    const resp = await httpPost(
      `${VALIDATOR_API}/v0/admin/users`,
      { name: userId, createPartyIfMissing: true },
      token,
    );
    partyId = resp.party_id;
  } else {
    // userAuth: sub = the user_id being registered
    const token = buildToken(userId);
    console.log(`\n[1] Self-registering user "${userId}"...`);
    const resp = await httpPost(
      `${VALIDATOR_API}/v0/register`,
      {},
      token,
    );
    partyId = resp.party_id;
  }

  if (!partyId) throw new Error('No party_id in response');
  console.log(`\nParty registered: ${partyId}`);

  // Save to party-ids.json
  let partyIds = {};
  if (fs.existsSync(PARTY_IDS_FILE)) {
    partyIds = JSON.parse(fs.readFileSync(PARTY_IDS_FILE, 'utf8'));
  }
  partyIds[keyName] = partyId;
  fs.writeFileSync(PARTY_IDS_FILE, JSON.stringify(partyIds, null, 2));
  console.log(`\nSaved to ${PARTY_IDS_FILE}:`);
  console.log(JSON.stringify(partyIds, null, 2));
}

main().catch(err => {
  console.error('\nError:', err.message ?? err);
  process.exit(1);
});
