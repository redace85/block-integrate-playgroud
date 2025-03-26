# ICP-protocol


## icp doc 
https://internetcomputer.org/docs/current/developer-docs/getting-started/overview-of-icp

## icp explorer 
https://dashboard.internetcomputer.org/transactions

## java lib 
https://github.com/ic4j/ic4j-agent

## dfx tools
DFX_VERSION=0.14.1 sh -ci "$(curl -sSL https://internetcomputer.org/install.sh)"

## icp_rosetta api
// api is provided by a unopen-source docker image dfinity/rosetta-api
https://internetcomputer.org/docs/current/developer-docs/defi/rosetta/icp_rosetta/
https://internetcomputer.org/docs/current/developer-docs/defi/rosetta/overview

docker run -d -p 8081:8081 -v ./rosetta_data:/data dfinity/rosetta-api --mainnet --not-whitelisted
docker run -d -p 8082:8082 -v ./icrc_data:/data dfinity/ic-icrc-rosetta-api --network-type mainnet --port 8082 --ledger-id mxzaz-hqaaa-aaaar-qaada-cai --store-file /data/db.sqlite


## Zilliqa rosetta
https://github.com/Zilliqa/zilliqa-rosetta
refer to 
https://github.com/Zilliqa/zilliqa-rosetta/blob/master/rosetta_standalone/README.md
