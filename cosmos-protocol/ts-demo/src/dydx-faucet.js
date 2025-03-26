import { FaucetClient, FaucetApiHost, Network } from '@dydxprotocol/v4-client-js';

const client = new FaucetClient(FaucetApiHost.TESTNET);
const address = 'dydx1pl288vfxahv056e46xy5tdy4pttqxgkw2u76r2';

// Use faucet to fill subaccount
// const faucetResponse = await client?.fill(address, 0, 2000);
// const faucetResponse = await client?.fill_native(address);
const faucetResponse = await client?.fillNative(address);

// console.log(faucetResponse);
const status = faucetResponse.status;
console.log(status);