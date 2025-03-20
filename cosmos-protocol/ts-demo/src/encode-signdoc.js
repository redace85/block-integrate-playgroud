import { 
	Registry, 
	makeAuthInfoBytes,
  makeSignDoc
} from "@cosmjs/proto-signing";

import{
  AminoTypes,
  createDefaultAminoConverters
} from "@cosmjs/stargate"

import { SignDoc } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { fromBase64, toBase64 } from "@cosmjs/encoding";

// const josnStr = '{ "account_number": "283859", "chain_id": "mantra-dukong-1", "fee": { "gas": "285680", "amount": [ { "amount": "3429", "denom": "uom" } ] }, "memo": "", "msgs": [ { "type": "sign/MsgSignData", "value": { "signer": "mantra1lskyt5k6hwzl2365a3pxdvtklsc705guy3cp8c", "data": "xxxxxx" } } ], "sequence": "8" }';
// const jobj = JSON.parse(josnStr)
const jobj = {
  chain_id: "",
  account_number: "0",
  sequence: "0",
  fee: { gas: "0", amount: [] },
  memo: "",
  msgs: [
  {
    type: "sign/MsgSignData",
    value: {
    signer: "bbn1pl288vfxahv056e46xy5tdy4pttqxgkw5mp0uy",
    data: "Qnkgc2lnbmluZyB0aGlzIG1lc3NhZ2UsIHlvdSBoZXJlYnkgYWNrbm93bGVkZ2UgdGhhdCB5b3UgaGF2ZSByZWFkLCB1bmRlcnN0b29kLCBhbmQgYWdyZWUgdG8gdGhlIEFpcmRyb3AgVGVybXMgKGF2YWlsYWJsZSBhdCBodHRwczovL2FpcmRyb3AuYmFieWxvbi5mb3VuZGF0aW9uL2FpcmRyb3AtdGVybXMpIGFuZCB0aGUgUHJpdmFjeSBQb2xpY3kgKGF2YWlsYWJsZSBhdCBodHRwczovL2FpcmRyb3AuYmFieWxvbi5mb3VuZGF0aW9uL2N1bmVpZm9ybS1wcml2YWN5LXBvbGljeSku",
    },
  },
  ],
};

// console.log(jobj.msgs);
const pkB64 = 'BGqEXb4vqlMWxKjYCUZUvL3nGcetC95cAfENewMouY/UUAGR1iWB0YM6xkuxVVHwlOCRFU2zqKlqNoeOM11Q0Uc=';
const pubkey = fromBase64(pkB64);

const aminoTypes = new AminoTypes(createDefaultAminoConverters())

const signedTxBody = {
    messages: jobj.msgs.map((msg) => aminoTypes.fromAmino(msg)),
    memo: jobj.memo,
};

const txBodyEncodeObject = {
  typeUrl: "/cosmos.tx.v1beta1.TxBody",
  value: signedTxBody
};
const registry = new Registry();
const txBodyBytes = registry.encode(txBodyEncodeObject);

const sequence = jobj.sequence;
const authInfoBytes = makeAuthInfoBytes(
  [{ pubkey, sequence }],
  jobj.fee.amount,
  jobj.fee.gas,
  "",
  "",
);

const signDoc = makeSignDoc(txBodyBytes, authInfoBytes, jobj.chain_id, jobj.account_number);
const signDocBytes = SignDoc.encode(signDoc).finish();

console.log(toBase64(signDocBytes));
