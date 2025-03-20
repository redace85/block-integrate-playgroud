import { 
  makeADR36AminoSignDoc,
  serializeSignDoc
} from "@keplr-wallet/cosmos";

import { toBase64 } from "@cosmjs/encoding";
import { fromByteArray } from "base64-js"

const signer = "bbn1pl288vfxahv056e46xy5tdy4pttqxgkw5mp0uy";
const data = "origna msg";
const signDoc = makeADR36AminoSignDoc(signer, data);

console.log(toBase64(serializeSignDoc(signDoc)));

console.log(fromByteArray(serializeSignDoc(signDoc)));
