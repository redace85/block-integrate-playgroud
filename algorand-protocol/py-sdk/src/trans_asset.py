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
sender_addr = os.getenv("ADDR1")
recv_addr = 'E7FBS7ZOGL2FHFMKJWIS6NJYHEALNEPGMN2572TPZX75B4SSDVGMQJVBRE'
pk = os.getenv("PK1")
print(f"addr: {sender_addr} \npk: {pk}")

sp = algod_client.suggested_params()
# Create transfer transaction
xfer_txn = transaction.AssetTransferTxn(
    sender=sender_addr,
    sp=sp,
    receiver=recv_addr,
    amt=50000000,
    index=asset_id,
)
signed_xfer_txn = xfer_txn.sign(pk)
txid = algod_client.send_transaction(signed_xfer_txn)
print(f"Sent transfer transaction with txid: {txid}")

results = transaction.wait_for_confirmation(algod_client, txid, 4)
print(f"Result confirmed in round: {results['confirmed-round']}")
