# neal-protocol

## account data
the generated accounts data is locate at '~/.near-credentials'

## ft contract example
https://github.com/near-examples/FT

## js version near-cli
https://github.com/near/near-cli

setup need node installed, and it use near-api-js underhood

## rust version near-cli-rs
https://github.com/near/near-cli-rs

replace infura rpc endpoint in config file
https://github.com/near/near-cli-rs/blob/master/docs/README.en.md#config

this version seems better than js version,and support token operations.

### view near balance
near-cli tokens jaeliu.testnet view-near-balance network-config testnet now

### view ft balance token:dai.fakes.testnet
near-cli tokens jaeliu.testnet view-ft-balance dai.fakes.testnet network-config testnet now

### view ft balance token:wrap.testnet
near-cli tokens jaeliu.testnet view-ft-balance wrap.testnet network-config testnet now

### view ft metadata token:usdt.fakes.testnet
near-cli contract call-function as-read-only usdt.fakes.testnet ft_metadata json-args {} network-config testnet now

### check whether account have called storage_depoist yet
near-cli contract call-function as-read-only usdt.fakes.testnet storage_balance_of json-args '{"account_id": "token.jaeliu.testnet"}' network-config testnet now

### send ft token:usdt.fakes.testnet
near-cli tokens redace85.testnet send-ft usdt.fakes.testnet jaeliu.testnet1000000 --prepaid-gas '30.000 TeraGas' --attached-deposit '0.000000000000000000000001 NEAR' network-config testnet sign-with-keychain

### generate implicit account
near-cli account create-account fund-later use-auto-generation save-to-folder ~/.near-credentials/implicit

### deploy ft contract
near-cli contract deploy token.jaeliu.testnet use-file res/fungible_token.wasm with-init-call new '{"owner_id": "jaeliu.testnet", "total_supply": "1000000000000000", "metadata": { "spec": "ft-1.0.0", "name": "Jae test Token", "symbol": "JAE", "decimals": 8 }}' --prepaid-gas '100.000 TeraGas' --attached-deposit '0 NEAR' network-config testnet sign-with-keychain
