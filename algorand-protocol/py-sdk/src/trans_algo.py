import json
from base64 import b64decode
from dotenv import load_dotenv
import os

from algosdk import transaction
from algosdk.v2client import algod

load_dotenv()

# Create a new algod client, configured to connect to our local sandbox
algod_address = "https://node.testnet.algoexplorerapi.io"
algod_token = "a" * 64
algod_client = algod.AlgodClient(algod_token, algod_address)

# Or, if necessary, pass alternate headers

# ! argments
sender_addr = os.getenv("ADDR1")
recv_addr = 'E7FBS7ZOGL2FHFMKJWIS6NJYHEALNEPGMN2572TPZX75B4SSDVGMQJVBRE'
pk = os.getenv("PK1")
print(f"addr: {sender_addr} \npk: {pk}")

# grab suggested params from algod using client
# includes things like suggested fee and first/last valid rounds
params = algod_client.suggested_params()
unsigned_txn = transaction.PaymentTxn(
    sender=sender_addr,
    sp=params,
    receiver=recv_addr,
    amt=500000,
    note=b"Hello World",
)

# example: TRANSACTION_PAYMENT_SIGN
# sign the transaction
signed_txn = unsigned_txn.sign(pk)
# example: TRANSACTION_PAYMENT_SIGN

# example: TRANSACTION_PAYMENT_SUBMIT
# submit the transaction and get back a transaction id
txid = algod_client.send_transaction(signed_txn)
print("Successfully submitted transaction with txID: {}".format(txid))

# wait for confirmation
txn_result = transaction.wait_for_confirmation(algod_client, txid, 4)

print(f"Transaction information: {json.dumps(txn_result, indent=4)}")
print(f"Decoded note: {b64decode(txn_result['txn']['txn']['note'])}")
