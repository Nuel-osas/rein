import { BorshCoder, type Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import idlJson from '../../idl/rein.json' with { type: 'json' };
import type { Rein } from '../../idl/rein.ts';

/** The raw (snake_case) IDL that the deployed program was built with. */
export const IDL = idlJson as unknown as Idl;
export const IDL_PROGRAM_ID = new PublicKey(idlJson.address);
export const coder = new BorshCoder(IDL);

export type ReinErrorName = Rein['errors'][number]['name'];

export interface IdlError {
  code: number;
  name: string;
  msg?: string;
}

export const IDL_ERRORS: readonly IdlError[] = (idlJson.errors ?? []) as IdlError[];
