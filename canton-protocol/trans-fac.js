#!/usr/bin/env node
'use strict';

// Canton coin (Amulet) transfer via Token Standard TransferFactory choice.
//
// Flow (ref: https://github.com/canton-network/splice/blob/main/token-standard/cli/src/commands/transfer.ts):
//   1. Query sender holdings via HoldingInterface filter (ACS)
//   2. POST registry /registry-transfer-instruction-v1/transfer-factory → factoryId + disclosedContracts + choiceContextData
//   3. Build ExerciseCommand{TransferFactory_Transfer}
//   4. POST /v2/interactive-submission/prepare  (with disclosedContracts)
//   5. Sign preparedTransactionHash (ED25519, base64 out, SIGNATURE_FORMAT_RAW)
//   6. POST /v2/interactive-submission/execute  (async)
//   7. Poll /v2/commands/completions until matching commandId+submissionId
//
// Usage:
//   node trans-fac.js <receiver_party_id> [amount] [reason]
//   node trans-fac.js --query-holdings [sender_party_id]
//
// Env vars:
//   PARTICIPANT           Ledger API base URL  (default: http://10.108.2.200:7575)
//   REGISTRY_URL          Token Standard registry base URL
//   LEDGER_TOKEN          JWT for Ledger API
//   INSTRUMENT_ADMIN      DSO party ID (admin of Canton Coin)
//   INSTRUMENT_ID         Instrument identifier (default: Amulet)
//   USER_ID               Ledger API user ID

const crypto = require('node:crypto');
const fs     = require('node:fs');
const path   = require('node:path');

// ─── Config ───────────────────────────────────────────────────────────────────

const PARTICIPANT = process.env.PARTICIPANT || 'http://10.108.2.200:7575';

// Token Standard registry: serves /registry-transfer-instruction-v1/transfer-factory
// Hosted by the DSO/SV scan app — NOT the validator node.
// Discover via: GET <scan>/v0/ans-entries/by-party/<INSTRUMENT_ADMIN>
//   → response.description JSON → meta['splice.lfdecentralizedtrust.org/registry-urls']
// Set via: REGISTRY_URL=http://<sv-scan-host>:<port> node trans-fac.js ...
const REGISTRY_URL = 'https://scan.sv-1.dev.global.canton.network.proofgroup.xyz'

const TOKEN = process.env.LEDGER_TOKEN ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJhdWQiOiJodHRwczovL2NhbnRvbi5uZXR3b3JrLmdsb2JhbCIsInN1YiI6ImxlZGdlci1hcGktdXNlciJ9' +
  '.A0VZW69lWWNVsjZmDDpVvr1iQ_dJLga3f-K2bicdtsc';

// DSO party: found by querying ValidatorRight contracts in ACS
const INSTRUMENT_ADMIN = process.env.INSTRUMENT_ADMIN ||
  'DSO::1220be58c29e65de40bf273be1dc2b266d43a9a002ea5b18955aeef7aac881bb471a';
const INSTRUMENT_ID = process.env.INSTRUMENT_ID || 'Amulet';
const USER_ID       = process.env.USER_ID || 'ledger-api-user';

const PRIVATE_KEY_FILE = path.join(__dirname, 'private_key.der');
const PARTY_IDS_FILE   = path.join(__dirname, 'party-ids.json');

// Token Standard interface IDs (from constants.ts)
const HOLDING_INTERFACE_ID =
  '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding';
const TRANSFER_FACTORY_TEMPLATE_ID =
  '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory';

// ─── CLI args ─────────────────────────────────────────────────────────────────

const QUERY_ONLY      = process.argv[2] === '--query-holdings';
const RECEIVER_ARG    = QUERY_ONLY ? null : process.argv[2];
const AMOUNT_ARG      = QUERY_ONLY ? null : (process.argv[3] || '9');
const REASON_ARG      = QUERY_ONLY ? null : (process.argv[4] || 'transfer via token standard');
const SENDER_OVERRIDE = QUERY_ONLY ? process.argv[3] : null;

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

const AUTH_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${TOKEN}`,
};

async function httpGet(url) {
  const r = await fetch(url, { headers: AUTH_HEADERS });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function httpPost(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: AUTH_HEADERS,
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${url} → ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : {};
}

// Registry endpoints require no auth per Token Standard spec
async function registryPost(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${url} → ${r.status} ${await r.text()}`);
  return r.json();
}

// ─── Ledger helpers ───────────────────────────────────────────────────────────

async function getLedgerEnd() {
  const d = await httpGet(`${PARTICIPANT}/v2/state/ledger-end`);
  return d.offset;
}

// ─── Holdings via HoldingInterface filter ─────────────────────────────────────

async function queryHoldings(partyId) {
  const offset = await getLedgerEnd();

  const acs = await httpPost(`${PARTICIPANT}/v2/state/active-contracts`, {
    filter: {
      filtersByParty: {
        [partyId]: {
          cumulative: [{
            identifierFilter: {
              InterfaceFilter: {
                value: {
                  interfaceId: HOLDING_INTERFACE_ID,
                  includeInterfaceView: true,
                  includeCreatedEventBlob: true,
                },
              },
            },
          }],
        },
      },
    },
    verbose: false,
    activeAtOffset: offset,
  });

  return acs.map(h => {
    const ev   = h.contractEntry?.JsActiveContract?.createdEvent;
    const view = ev?.interfaceViews?.[0]?.viewValue;
    return {
      contractId:   ev?.contractId,
      amount:       view?.amount ?? null,
      instrumentId: view?.instrumentId ?? null,
    };
  }).filter(h => h.contractId);
}

// ─── Key helpers ──────────────────────────────────────────────────────────────

function loadKeys() {
  const der        = fs.readFileSync(PRIVATE_KEY_FILE);
  const privateKey = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const pubDer     = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });

  // Canton key fingerprint format (from ledger-api-utils.ts):
  //   signedBy = "1220" + sha256(0x0000000C || pubKeyBytes).hex
  // where "1220" is the multihash prefix (0x12=sha256, 0x20=32 bytes)
  // and 0x0000000C is the 4-byte big-endian encoding of the Ed25519 key type
  const pubKeyHex     = pubDer.subarray(-32).toString('hex');
  const hashInput     = Buffer.from(`0000000C${pubKeyHex}`, 'hex');
  const keyFingerprint = crypto.createHash('sha256').update(hashInput).digest('hex');
  const fingerprint   = `1220${keyFingerprint}`;

  return { privateKey, fingerprint };
}

// Sign base64-encoded hash; return base64-encoded raw ED25519 signature (ieee-p1363 = r||s)
function signHash(base64Hash, privateKey) {
  const hashBuffer = Buffer.from(base64Hash, 'base64');
  return crypto
    .sign(null, hashBuffer, { key: privateKey, dsaEncoding: 'ieee-p1363' })
    .toString('base64');
}

// ─── Transfer factory (registry) ─────────────────────────────────────────────

async function getTransferFactory(choiceArgs) {
  // const url = `${REGISTRY_URL}/registry-transfer-instruction-v1/transfer-factory`;
  // return registryPost(url, { choiceArguments: choiceArgs });

  return JSON.parse(fs.readFileSync('fac.json', 'utf8'));
}

// ─── Interactive submission ───────────────────────────────────────────────────

async function prepareAndExecute(partyId, exerciseCommand, disclosedContracts, privateKey, fingerprint) {
  const commandId    = `tscli-${crypto.randomUUID()}`;
  const submissionId = crypto.randomUUID();

  // All disclosed contracts must be in the same synchronizer
  const synchronizerId = disclosedContracts[0]?.synchronizerId;
  if (!synchronizerId) throw new Error('No synchronizerId found in disclosedContracts');

  // Step 1: Prepare
  const prepared = await httpPost(`${PARTICIPANT}/v2/interactive-submission/prepare`, {
    actAs:    [partyId],
    readAs:   [partyId],
    userId:   USER_ID,
    commandId,
    synchronizerId,
    commands: [{ ExerciseCommand: exerciseCommand }],
    disclosedContracts,
    verboseHashing:               false,
    packageIdSelectionPreference: [],
  });

  const { preparedTransaction, preparedTransactionHash, hashingSchemeVersion } = prepared;
  console.log(`  commandId    : ${commandId}`);
  console.log(`  submissionId : ${submissionId}`);

  // Step 2: Sign
  const signature = signHash(preparedTransactionHash, privateKey);

  // Capture ledger end before execute so completions poll starts at the right offset
  const ledgerEndBefore = await getLedgerEnd();

  // Step 3: Execute (async)
  await httpPost(`${PARTICIPANT}/v2/interactive-submission/execute`, {
    userId: USER_ID,
    submissionId,
    preparedTransaction,
    hashingSchemeVersion,
    deduplicationPeriod: { Empty: {} },
    partySignatures: {
      signatures: [{
        party: partyId,
        signatures: [{
          signature,
          signedBy:             fingerprint,
          format:               'SIGNATURE_FORMAT_RAW',
          signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519',
        }],
      }],
    },
  });

  // Step 4: Poll completions
  console.log('  Waiting for completion...');
  return awaitCompletion(partyId, commandId, submissionId, ledgerEndBefore);
}

// ─── Poll completions ─────────────────────────────────────────────────────────

const COMPLETION_TIMEOUT_MS = 90_000;

async function awaitCompletion(partyId, commandId, submissionId, beginOffset, deadline) {
  if (!deadline) deadline = Date.now() + COMPLETION_TIMEOUT_MS;
  if (Date.now() > deadline) {
    throw new Error(`Timed out waiting for completion (commandId=${commandId})`);
  }

  // limit=100, idle_timeout_ms=1000 matches reference CLI defaults
  const url = `${PARTICIPANT}/v2/commands/completions?limit=100&idle_timeout_ms=1000`;
  const responses = await httpPost(url, {
    userId:         USER_ID,
    parties:        [partyId],
    beginExclusive: String(beginOffset),
  });

  const items = Array.isArray(responses) ? responses : (responses ? [responses] : []);
  const completions = items.filter(r => r?.completionResponse?.Completion);

  const match = completions.find(r => {
    const c = r.completionResponse.Completion.value;
    return c?.userId === USER_ID && c?.commandId === commandId && c?.submissionId === submissionId;
  });

  if (match) {
    const c = match.completionResponse.Completion.value;
    if (c.status && c.status.code !== 0) {
      throw new Error(`Command failed: ${JSON.stringify(c.status)}`);
    }
    return {
      updateId:       c.updateId ?? '',
      synchronizerId: c.synchronizerTime?.synchronizerId,
      recordTime:     c.synchronizerTime?.recordTime,
    };
  }

  // Advance offset to last seen completion offset and retry
  const last      = completions[completions.length - 1];
  const newOffset = last?.completionResponse?.Completion?.value?.offset ?? beginOffset;
  await new Promise(r => setTimeout(r, 500));
  return awaitCompletion(partyId, commandId, submissionId, newOffset, deadline);
}

// ─── Sender party ID ─────────────────────────────────────────────────────────

function loadSenderPartyId() {
  if (SENDER_OVERRIDE) return SENDER_OVERRIDE;
  if (fs.existsSync(PARTY_IDS_FILE)) {
    const saved = JSON.parse(fs.readFileSync(PARTY_IDS_FILE, 'utf8'));
    if (saved.local1) return saved.local1;
  }
  throw new Error(`No sender party ID — pass as arg or set local1 in ${PARTY_IDS_FILE}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // REGISTRY_URL must point to the DSO/SV scan app, not the validator.
  // It is NOT available at the validator (5003) or Ledger API (7575) endpoints.
  if (!REGISTRY_URL && !QUERY_ONLY) {
    console.error([
      'Error: REGISTRY_URL is required.',
      '',
      'The Token Standard registry (/registry-transfer-instruction-v1/transfer-factory) is',
      'hosted by the DSO/SV scan app — not the validator node.',
      '',
      'To discover the URL:',
      '  GET <scan>/v0/ans-entries/by-party/<DSO-party-id>',
      '  → description JSON → meta["splice.lfdecentralizedtrust.org/registry-urls"]',
      '',
      'Usage:',
      '  REGISTRY_URL=http://<sv-scan-host>:<port> node trans-fac.js <receiver> [amount] [reason]',
    ].join('\n'));
    process.exit(1);
  }

  const senderPartyId = loadSenderPartyId();

  if (QUERY_ONLY) {
    console.log(`=== Holdings (HoldingInterface) for ${senderPartyId} ===`);
    const holdings = await queryHoldings(senderPartyId);
    if (holdings.length === 0) {
      console.log('  (none)');
    } else {
      for (const h of holdings) {
        console.log(`  contractId : ${h.contractId}`);
        console.log(`  amount     : ${JSON.stringify(h.amount)}`);
        console.log(`  instrument : ${JSON.stringify(h.instrumentId)}`);
        console.log('');
      }
    }
    return;
  }

  if (!RECEIVER_ARG) {
    console.error('Usage: node trans-fac.js <receiver_party_id> [amount] [reason]');
    console.error('       node trans-fac.js --query-holdings [sender_party_id]');
    process.exit(1);
  }

  const receiver = RECEIVER_ARG;
  const amount   = AMOUNT_ARG;
  const reason   = REASON_ARG;

  console.log(`Participant      : ${PARTICIPANT}`);
  console.log(`Registry URL     : ${REGISTRY_URL}`);
  console.log(`Instrument admin : ${INSTRUMENT_ADMIN}`);
  console.log(`Sender           : ${senderPartyId}`);
  console.log(`Receiver         : ${receiver}`);
  console.log(`Amount           : ${amount} Amulet`);
  console.log(`Reason           : ${reason}`);

  const { privateKey, fingerprint } = loadKeys();
  console.log(`Key fingerprint  : ${fingerprint}`);

  // [1] Query holdings via HoldingInterface filter
  console.log('\n[1] Querying sender holdings (HoldingInterface)...');
  const holdings = await queryHoldings(senderPartyId);
  if (holdings.length === 0) throw new Error('Sender has no holdings — cannot transfer');
  console.log(`  Found ${holdings.length} holding(s):`);
  for (const h of holdings) console.log(`    + ${h.contractId}  amount=${JSON.stringify(h.amount)}`);
  // const inputHoldingCids = holdings.map(h => h.contractId);
  const inputHoldingCids = [holdings[0].contractId];

  // [2] Build choiceArgs
  const now           = new Date();
  const executeBefore = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const choiceArgs = {
    expectedAdmin: INSTRUMENT_ADMIN,
    transfer: {
      sender:          senderPartyId,
      receiver,
      amount,
      instrumentId:    { admin: INSTRUMENT_ADMIN, id: INSTRUMENT_ID },
      lock:            null,
      requestedAt:     now.toISOString(),
      executeBefore,
      inputHoldingCids,
      meta: {
        values: { 'splice.lfdecentralizedtrust.org/reason': reason },
      },
    },
    extraArgs: {
      context: { values: {} },
      meta:    { values: {} },
    },
  };

  // [3] Fetch transfer factory from registry
  console.log('\n[2] Fetching transfer factory from registry...');
  const transferFactory = await getTransferFactory(choiceArgs);
  const { factoryId, choiceContext } = transferFactory;
  const { disclosedContracts, choiceContextData } = choiceContext;
  console.log(`  factoryId          : ${factoryId}`);
  console.log(`  disclosedContracts : ${disclosedContracts.length}`);
  console.log(`  synchronizerId     : ${disclosedContracts[0]?.synchronizerId}`);

  // Inject context data returned by registry into extraArgs
  choiceArgs.extraArgs.context = choiceContextData;

  // [4] Build ExerciseCommand
  const exerciseCommand = {
    templateId:      TRANSFER_FACTORY_TEMPLATE_ID,
    contractId:      factoryId,
    choice:          'TransferFactory_Transfer',
    choiceArgument:  choiceArgs,
  };

  // [5-7] Prepare → Sign → Execute → Await completion
  console.log('\n[3] Submitting via interactive submission (prepare → execute → poll completions)...');
  const result = await prepareAndExecute(
    senderPartyId,
    exerciseCommand,
    disclosedContracts,
    privateKey,
    fingerprint,
  );

  console.log('\nTransfer OK!');
  console.log(`  updateId       : ${result.updateId}`);
  console.log(`  synchronizerId : ${result.synchronizerId ?? '(n/a)'}`);
  console.log(`  recordTime     : ${result.recordTime ?? '(n/a)'}`);
}

main().catch(err => {
  console.error('\nError:', err.message ?? err);
  process.exit(1);
});
