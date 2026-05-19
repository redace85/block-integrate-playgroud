#!/usr/bin/env node

// Copyright (c) 2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

let PARTY_NAME = 'cac-dev1';
let PARTICIPANT1 = 'http://10.108.2.200:7575';
let PRIVATE_KEY_FILE = 'private_key.der';

async function httpPost(url, payload) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJodHRwczovL2NhbnRvbi5uZXR3b3JrLmdsb2JhbCIsInN1YiI6ImxlZGdlci1hcGktdXNlciJ9.A0VZW69lWWNVsjZmDDpVvr1iQ_dJLga3f-K2bicdtsc' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`POST ${url} failed: ${resp.status} ${text}`);
  }
  return resp.json();
}

async function httpGet(url) {
  const resp = await fetch(url, {
    method: 'GET',
    headers: { 'accept': 'application/json', 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJodHRwczovL2NhbnRvbi5uZXR3b3JrLmdsb2JhbCIsInN1YiI6ImxlZGdlci1hcGktdXNlciJ9.A0VZW69lWWNVsjZmDDpVvr1iQ_dJLga3f-K2bicdtsc' },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GET ${url} failed: ${resp.status} ${text}`);
  }
  return resp.json();
}

async function main() {

  // Fetch participant2 ID when multi-hosted
  const otherConfirmingParticipantUids = [];

  // Determine synchronizer ID from participant1
  console.log(`Fetching ${PARTICIPANT1}/v2/state/connected-synchronizers`);
  const syncData = await httpGet(`${PARTICIPANT1}/v2/state/connected-synchronizers`);
  const synchronizerId = syncData.connectedSynchronizers[0].synchronizerId;
  console.log(`Detected synchronizer-id ${synchronizerId}`);

  // Generate or read ED25519 key pair
  let privateKeyDer;
  let publicKeyBase64;

  if (!fs.existsSync(PRIVATE_KEY_FILE)) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
      publicKeyEncoding: { type: 'spki', format: 'der' },
    });
    privateKeyDer = privateKey;
    fs.writeFileSync(PRIVATE_KEY_FILE, privateKeyDer);
    fs.writeFileSync('public_key.der', publicKey);
    publicKeyBase64 = publicKey.toString('base64');
  } else {
    privateKeyDer = fs.readFileSync(PRIVATE_KEY_FILE);
    const privKey = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
    const pubKeyDer = crypto.createPublicKey(privKey).export({ type: 'spki', format: 'der' });
    publicKeyBase64 = pubKeyDer.toString('base64');
  }
  console.log(publicKeyBase64);

  // Request topology transactions
  console.log('Requesting generate topology transactions');
  const onboardingTx = await httpPost(`${PARTICIPANT1}/v2/parties/external/generate-topology`, {
    synchronizer: synchronizerId,
    partyHint: PARTY_NAME,
    publicKey: {
      format: 'CRYPTO_KEY_FORMAT_DER_X509_SUBJECT_PUBLIC_KEY_INFO',
      keyData: publicKeyBase64,
      keySpec: 'SIGNING_KEY_SPEC_EC_CURVE25519',
    },
    otherConfirmingParticipantUids,
  });

  const { partyId, publicKeyFingerprint, multiHash } = onboardingTx;
  const transactions = onboardingTx.topologyTransactions.map(t => ({ transaction: t }));

  // Sign the multi-hash with ED25519 (raw, no pre-hashing — matches openssl pkeyutl -rawin)
  console.log(`Signing hash ${multiHash} for ${partyId} using ED25519`);
  const hashBinary = Buffer.from(multiHash, 'base64');
  const privateKey = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
  const signature = crypto.sign(null, hashBinary, privateKey).toString('base64');

  // Submit to participant1
  console.log('Submitting onboarding transaction to participant1');
  let result = await httpPost(`${PARTICIPANT1}/v2/parties/external/allocate`, {
    synchronizer: synchronizerId,
    onboardingTransactions: transactions,
    multiHashSignatures: [{
      format: 'SIGNATURE_FORMAT_CONCAT',
      signature,
      signedBy: publicKeyFingerprint,
      signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519',
    }],
  });

  console.log(`Onboarded party ${result.partyId}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
