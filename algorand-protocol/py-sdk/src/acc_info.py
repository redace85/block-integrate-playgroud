from typing import Dict, Any
from algosdk.v2client import algod

# Create a new algod client, configured to connect to our local sandbox
algod_address = "https://node.testnet.algoexplorerapi.io"
algod_token = "a" * 64
algod_client = algod.AlgodClient(algod_token, algod_address)


# !account
account_addr = 'SEK4WEBZZPEALV64ATTI6LGQQANWCLTB7UHKBHMM5GTRNXOPZDSDVA2MTQ'

account_info: Dict[str, Any] = algod_client.account_info(account_addr)
print(f"Account balance: {account_info.get('amount')} microAlgos")
print(account_info)
