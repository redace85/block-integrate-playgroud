import { 
	DirectSecp256k1Wallet,
	Registry, 
	encodePubkey,
	makeAuthInfoBytes,
	makeSignDoc,
} from "@cosmjs/proto-signing";
import { fromBase64, toBase64 } from "@cosmjs/encoding";
import { encodeSecp256k1Pubkey, } from "@cosmjs/amino";

import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";

import * as dotenv from 'dotenv'
dotenv.config()

const pkstr = process.env.PK;
const accountNumber = process.env.ACC_NUM;
const sequence = process.env.SEQ;
// const chainId = "theta-testnet-001";
const chainId = "kava_2221-16000";
const denom = "ukava";
const addrPrefix = "kava";

const gasLimit = 100000;
const memo = "manual tx";

const pk = Uint8Array.from(Buffer.from(pkstr, 'hex'));
const wallet = await DirectSecp256k1Wallet.fromKey(pk, addrPrefix);
const [account] = await wallet.getAccounts();
console.log(account);

// const recipient = "cosmos1txpja995am9hffzc05ux8qj7ra7vq4ng93fm3s";
const recipient = "kava14n56f7mqm6ny9pjedszeejk7h9ksaf46aqw39r";
const amount = {
  denom: denom, 
  amount: "500000",
};

const sendMsg = {
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: {
        fromAddress: account.address,
        toAddress: recipient,
        amount: [amount],
      },
    };


const registry = new Registry();

const pubkey = encodePubkey(encodeSecp256k1Pubkey(account.pubkey));

const txBodyEncodeObject = {
  typeUrl: "/cosmos.tx.v1beta1.TxBody",
  value: {
    messages: [sendMsg],
    memo: memo,
  },
};
const txBodyBytes = registry.encode(txBodyEncodeObject);
const authInfoBytes = makeAuthInfoBytes(
  [{ pubkey, sequence }],
  [{denom: denom, amount: "1000"}],
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
