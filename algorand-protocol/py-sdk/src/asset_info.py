from typing import Dict, Any
from algosdk.v2client import algod

# Create a new algod client, configured to connect to our local sandbox
algod_address = "https://node.testnet.algoexplorerapi.io"
algod_token = "a" * 64
algod_client = algod.AlgodClient(algod_token, algod_address)


# !asset_id usdc
asset_id = '10458941'

asset_info = algod_client.asset_info(asset_id)
asset_params: Dict[str, Any] = asset_info["params"]
print(f"Asset Name: {asset_params['name']}")
print(f"Asset params: {list(asset_params.keys())}")
