// Program-wide figures for /spike/stats: every Team, Spender, Payment and Service account of the
// Rein program on this cluster, read with getProgramAccounts by discriminator. Each part that fails
// to read is null (unknown), never zero. Money stays in bigint base units.

import {Connection} from '@solana/web3.js';
import {PROGRAM_ID} from './chain';
import {coder, readConfig, toPayment, toService, toSpender, toTeam, type Config, type Payment, type Service, type Spender, type Team} from './rein';

type Name = 'Team' | 'Spender' | 'Payment' | 'Service';

async function all(conn: Connection, name: Name) {
  try {
    return await conn.getProgramAccounts(PROGRAM_ID, {
      filters: [{memcmp: coder.accounts.memcmp(name) as {offset: number; bytes: string}}],
      commitment: 'confirmed',
    });
  } catch {
    return null;
  }
}

export type ProgramStats = {
  config: Config | null;
  teams: Team[] | null;
  spenders: Spender[] | null;
  payments: Payment[] | null;
  services: Service[] | null;
  at: number;
};

type Rows = NonNullable<Awaited<ReturnType<typeof all>>>;

function decodeAll<T>(rows: Rows | null, f: (address: string, info: Rows[number]['account']) => T | null): T[] | null {
  return rows ? rows.map((r) => f(r.pubkey.toBase58(), r.account)).filter((x): x is T => x !== null) : null;
}

export async function readProgramStats(conn: Connection): Promise<ProgramStats> {
  const [config, teams, spenders, payments, services] = await Promise.all([readConfig(conn), all(conn, 'Team'), all(conn, 'Spender'), all(conn, 'Payment'), all(conn, 'Service')]);
  return {
    config,
    teams: decodeAll(teams, toTeam),
    spenders: decodeAll(spenders, toSpender),
    payments: decodeAll(payments, toPayment),
    services: decodeAll(services, toService),
    at: Date.now(),
  };
}
