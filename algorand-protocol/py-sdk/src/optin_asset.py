from dotenv import load_dotenv
import os

from algosdk import transaction
from algosdk.v2client import algod

load_dotenv()

# Create a new algod client, configured to connect to our local sandbox
algod_address = "https://node.testnet.algoexplorerapi.io"
algod_token = "a" * 64
algod_client = algod.AlgodClient(algod_token, algod_address)

# ! argments
asset_id = '10458941'
account_addr = os.getenv("ADDR2")
pk = os.getenv("PK2")
print(f"addr: {account_addr} \npk: {pk}")

sp = algod_client.suggested_params()
# Create opt-in transaction
# asset transfer from me to me for asset id we want to opt-in to with amt==0
optin_txn = transaction.AssetOptInTxn(
    sender=account_addr, sp=sp, index=asset_id
)
signed_optin_txn = optin_txn.sign(pk)
txid = algod_client.send_transaction(signed_optin_txn)
print(f"Sent opt in transaction with txid: {txid}")

# Wait for the transaction to be confirmed
results = transaction.wait_for_confirmation(algod_client, txid, 4)
print(f"Result confirmed in round: {results['confirmed-round']}")

