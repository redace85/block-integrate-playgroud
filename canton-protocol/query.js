#!/usr/bin/env node
'use strict';

async function main() {
  const reason = 'transfer choice';
  const now           = new Date();
  const executeBefore = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const choiceArgs = {
    expectedAdmin: 'DSO::1220be58c29e65de40bf273be1dc2b266d43a9a002ea5b18955aeef7aac881bb471a',
    transfer: {
      sender: 'inlabelX2::1220369880c8a140cdac262ea989407de2c6d5578fdaf38511d7d5de58057fd3615c',
      receiver: 'inlabel::1220369880c8a140cdac262ea989407de2c6d5578fdaf38511d7d5de58057fd3615c',
      amount: 1,
      instrumentId:    { admin: 'DSO::1220be58c29e65de40bf273be1dc2b266d43a9a002ea5b18955aeef7aac881bb471a', id: 'Amulet' },
      lock:            null,
      requestedAt:     now.toISOString(),
      executeBefore,
      inputHoldingCids:['0008a13c37ae273db5be157a3eedf98a33c27e90ae64d7aaeef80b15f6fe370d26ca121220a12d55975e93e0d3a39bb7d16f93f76e7cb8332bf9ac988ce2cac888ec43cb6e'],
      meta: {
        values: { 'splice.lfdecentralizedtrust.org/reason': reason },
      },
    },
    extraArgs: {
      context: { values: {} },
      meta:    { values: {} },
    },
  };

  console.log(`json: ${JSON.stringify({ choiceArguments: choiceArgs })}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
