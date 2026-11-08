// What the UI says about the network. Rein runs on Solana devnet (or a local validator in
// development) with test USDC, so nothing here is real money.

import { CLUSTER, PROGRAM_ID, explorer } from '@/lib/chain';

export const ON_MAINNET = false;
export const NETWORK_NAME = CLUSTER === 'devnet' ? 'Solana devnet' : 'Solana localnet';
export const MAINNET_LINE = '';
export const TEST_FUNDS_LINE = `${NETWORK_NAME}: test USDC only, nothing here is real money.`;
export const PROGRAM_URL = explorer('address', PROGRAM_ID.toBase58());
