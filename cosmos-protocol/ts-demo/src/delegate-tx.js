import { 
  DirectSecp256k1Wallet,
  Registry, 
  encodePubkey,
  makeAuthInfoBytes,
  makeSignDoc,
} from "@cosmjs/proto-signing";
import { fromBase64, toBase64 } from "@cosmjs/encoding";
import { encodeSecp256k1Pubkey, } from "@cosmjs/amino";

import { MsgDelegate } from "cosmjs-types/cosmos/staking/v1beta1/tx.js";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";

import * as dotenv from 'dotenv'
dotenv.config()

const pkstr = process.env.PK;
const accountNumber = process.env.ACC_NUM;
const sequence = process.env.SEQ;
const chainId = "theta-testnet-001";

const memo = "manual tx";

const gasLimit = 400000;
const gasAmount = {
  denom: "uatom",
  amount: "4000",
};

const pk = Uint8Array.from(Buffer.from(pkstr, 'hex'));
const wallet = await DirectSecp256k1Wallet.fromKey(pk);
const [account] = await wallet.getAccounts();
console.log(account);

const amount = {
  denom: "uatom",
  amount: "500000",
};

const validator1 = "cosmosvaloper1uy97y2f8fm7l28tl0mr75pgdaf2rzxsg33zfpq";
const deMsg1 = {
  typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
  value: {
    delegatorAddress: account.address,
    validatorAddress: validator1,
    amount: amount,
  },
};

const validator2 = "cosmosvaloper13n6wqhq8la352je00nwq847ktp47pgknseu6kk";
const deMsg2 = {
  typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
  value: {
    delegatorAddress: account.address,
    validatorAddress: validator2,
    amount: amount,
  },
};

const registry = new Registry();
registry.register("/cosmos.staking.v1beta1.MsgDelegate", MsgDelegate);

const pubkey = encodePubkey(encodeSecp256k1Pubkey(account.pubkey));

const txBodyEncodeObject = {
  typeUrl: "/cosmos.tx.v1beta1.TxBody",
  value: {
    messages: [deMsg1,deMsg2],
    memo: memo,
  },
};
const txBodyBytes = registry.encode(txBodyEncodeObject);
const authInfoBytes = makeAuthInfoBytes(
  [{ pubkey, sequence }],
  [gasAmount],
  gasLimit,
  "",
  "",
);
const signDoc = makeSignDoc(txBodyBytes, authInfoBytes, chainId, accountNumber);
const { signature, signed } = await wallet.signDirect(account.address, signDoc);

const txRaw = TxRaw.fromPartial({
  bodyBytes: signed.bodyBytes,
  authInfoBytes: signed.authInfoBytes,
  signatures: [fromBase64(signature.signature)],
});


const txBytes = TxRaw.encode(txRaw).finish();
console.log(toBase64(txBytes));
