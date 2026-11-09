import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BN } from '@coral-xyz/anchor';
import { Keypair, PublicKey, SendTransactionError, type Connection } from '@solana/web3.js';
import { ReinChain } from '../src/chain.ts';
import { coder, IDL_PROGRAM_ID } from '../src/idl.ts';
import { payService } from '../src/pay.ts';

const pk = () => Keypair.generate().publicKey;
const agent = Keypair.generate();
const sponsor = Keypair.generate();
const owner = pk();
const mint = pk();
const probe = new ReinChain(null as never);
const team = probe.teamPda(owner);
const vault = ReinChain.vaultAddress(team, mint);
const payeeToken = pk();

async function fixtures() {
  const config = await coder.accounts.encode('Config', { admin: pk(), mint, services: 1, bump: 255 });
  const teamData = await coder.accounts.encode('Team', {
    owner, mint, vault, name: 'Acme', paused: false, spenders: 1, payments: new BN(0), paid_count: new BN(0),
    paid_total: new BN(0), created_at: new BN(1), bump: 255,
  });
  const service = await coder.accounts.encode('Service', {
    id: 'ai-chat', label: '0G Chat', payee: pk(), payee_token: payeeToken, price: new BN(400_000), active: true, bump: 255,
  });
  return { config, teamData, service };
}

async function paymentData(status: 'Paid' | 'Pending', reasons: number, amount: bigint) {
  return coder.accounts.encode('Payment', {
    team, spender: pk(), authority: agent.publicKey, kind: { Agent: {} }, service: pk(), payee_token: payeeToken,
    amount: new BN(amount.toString()), intent: 'ag-x', memo: '', generation: 0, reasons, status: { [status]: {} },
    created_at: new BN(100), deadline: new BN(status === 'Pending' ? 86_500 : 0), decided_at: new BN(0), number: new BN(0), bump: 255,
  });
}

interface Script {
  send?: (opts: { skipPreflight?: boolean }) => Promise<string>;
  status?: () => { err: unknown; confirmationStatus: string } | null;
  height?: number;
  payment?: Buffer | null;
  logs?: string[];
}

async function fakeChain(s: Script) {
  const f = await fixtures();
  const accounts = new Map<string, Buffer>([
    [probe.configPda().toBase58(), f.config],
    [team.toBase58(), f.teamData],
    [probe.servicePda('ai-chat').address.toBase58(), f.service],
  ]);
  const calls = { send: 0, status: 0, skipPreflight: [] as boolean[] };
  const conn = {
    async getAccountInfo(a: PublicKey) {
      const data = accounts.get(a.toBase58());
      if (data) return { data, owner: IDL_PROGRAM_ID, lamports: 1, executable: false };
      // Any other program-owned lookup is the payment record.
      if (s.payment && !accounts.has(a.toBase58()) && a.toBase58() !== probe.servicePda('wallet-9xqe').address.toBase58()) {
        return { data: s.payment, owner: IDL_PROGRAM_ID, lamports: 1, executable: false };
      }
      return null;
    },
    async getLatestBlockhash() {
      return { blockhash: pk().toBase58(), lastValidBlockHeight: 100 };
    },
    async sendRawTransaction(_raw: Buffer, opts: { skipPreflight?: boolean }) {
      calls.send++;
      calls.skipPreflight.push(!!opts.skipPreflight);
      return s.send ? s.send(opts) : 'sig';
    },
    async getSignatureStatuses() {
      calls.status++;
      return { value: [s.status ? s.status() : null] };
    },
    async getBlockHeight() {
      return s.height ?? 50;
    },
    async getTransaction() {
      return { meta: { logMessages: s.logs ?? [] } };
    },
  };
  return { chain: new ReinChain(conn as unknown as Connection), calls };
}

const params = (chain: ReinChain, serviceId = 'ai-chat') => ({
  chain, team, agent, sponsor, serviceId, amount: 400_000n, memo: 'test', confirmTimeoutMs: 2_000, pollMs: 5,
});

test('a confirmed payment reads the record: Paid', async () => {
  const { chain, calls } = await fakeChain({
    status: () => ({ err: null, confirmationStatus: 'confirmed' }),
    payment: await paymentData('Paid', 0, 400_000n),
  });
  const o = await payService(params(chain));
  assert.equal(o.status, 'paid');
  assert.equal(o.amount, 400_000n);
  assert.ok(o.signature);
  assert.equal(calls.send, 1);
  assert.deepEqual(calls.skipPreflight, [false], 'a registered service keeps preflight');
});

test('a confirmed payment over a limit is pending with decoded reasons', async () => {
  const { chain } = await fakeChain({
    status: () => ({ err: null, confirmationStatus: 'confirmed' }),
    payment: await paymentData('Pending', 3, 12_000_000n),
  });
  const o = await payService(params(chain));
  assert.equal(o.status, 'pending');
  assert.deepEqual(o.reasons, ['service_not_allowed', 'over_cap']);
  assert.equal(o.unconfirmed, undefined);
  assert.equal(o.deadline, 86_500);
});

test('an unknown service is sent anyway and the mined error comes back as refused', async () => {
  const { chain, calls } = await fakeChain({
    status: () => ({ err: { InstructionError: [0, { Custom: 3012 }] }, confirmationStatus: 'confirmed' }),
    logs: ['Program log: AnchorError caused by account: service. Error Code: AccountNotInitialized. Error Number: 3012. Error Message: The program expected this account to be already initialized.'],
  });
  const o = await payService(params(chain, 'wallet-9xqe'));
  assert.deepEqual(calls.skipPreflight, [true], 'sent without preflight so the failure is mined');
  assert.equal(o.status, 'refused');
  assert.equal(o.unknownService, true);
  assert.equal(o.error?.name, 'AccountNotInitialized');
  assert.equal(o.error?.account, 'service');
  assert.ok(o.signature, 'a mined refusal has a signature');
});

test('a network error on send is pending and unconfirmed, and the send is never repeated', async () => {
  const { chain, calls } = await fakeChain({
    send: async () => { throw new TypeError('fetch failed'); },
    status: () => null,
    height: 50,
  });
  const o = await payService({ ...params(chain), confirmTimeoutMs: 100 });
  assert.equal(o.status, 'pending');
  assert.equal(o.unconfirmed, true);
  assert.ok(o.signature);
  assert.match(o.error!.message, /fetch failed/);
  assert.equal(calls.send, 1);
  assert.ok(calls.status > 1, 'the confirmation check is retried');
});

test('no confirmation before the blockhash expires is still pending, never failed', async () => {
  const { chain } = await fakeChain({ status: () => null, height: 101 });
  const o = await payService(params(chain));
  assert.equal(o.status, 'pending');
  assert.equal(o.unconfirmed, true);
  assert.match(o.error!.message, /blockhash expired/);
});

test('status checks that throw are retried, not taken as an answer', async () => {
  let n = 0;
  const { chain } = await fakeChain({
    status: () => { if (n++ < 3) throw new Error('503'); return { err: null, confirmationStatus: 'confirmed' }; },
    payment: await paymentData('Paid', 0, 400_000n),
  });
  const o = await payService(params(chain));
  assert.equal(o.status, 'paid');
});

test('a preflight rejection is refused with no signature, because nothing was sent', async () => {
  const { chain } = await fakeChain({
    send: async () => {
      throw new SendTransactionError({
        action: 'simulate', signature: '', transactionMessage: 'Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1773',
        logs: ['Program log: AnchorError thrown in programs/rein/src/lib.rs:203. Error Code: ServiceSuspended. Error Number: 6003. Error Message: the service is suspended.'],
      });
    },
  });
  const o = await payService(params(chain));
  assert.equal(o.status, 'refused');
  assert.equal(o.error?.name, 'ServiceSuspended');
  assert.equal(o.signature, undefined);
});

test('a failed read stops before anything is signed or sent', async () => {
  const { chain, calls } = await fakeChain({});
  (chain.connection as unknown as { getAccountInfo: () => Promise<never> }).getAccountInfo = async () => {
    throw new Error('connection refused');
  };
  const o = await payService(params(chain));
  assert.equal(o.status, 'failed');
  assert.match(o.error!.message, /nothing was sent/);
  assert.equal(calls.send, 0);
});
