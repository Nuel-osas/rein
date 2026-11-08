// Rein program tests. They run against a validator that has been seeded with `pnpm seed`
// (the config is a singleton, so tests reuse its mint and the CLI wallet as admin).
//
//   REIN_RPC_URL=http://127.0.0.1:8999 pnpm test:rules

import { describe, it, before } from 'node:test';
import { expect } from 'chai';
import { BN } from '@coral-xyz/anchor';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { createAccount, getAccount, mintTo } from '@solana/spl-token';
import { adminKey, client, decodeReasons, key, pda, rpcUrl, U } from '../scripts/lib';

const conn = new Connection(rpcUrl(), 'confirmed');
const admin = adminKey();
const mintAuthority = key('mint-authority');
const sponsor = Keypair.generate();
const program = client(conn, sponsor); // the sponsor pays every fee and rent
const asAdmin = client(conn, admin);

const now = () => Math.floor(Date.now() / 1000);
const bn = (v: bigint | number) => new BN(v.toString());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const intent = () => `t${Date.now().toString(36)}${(n++).toString(36)}`;

async function fails(p: Promise<unknown>, needle: string) {
  try {
    await p;
  } catch (e) {
    const text = String(e) + JSON.stringify((e as { logs?: string[] }).logs ?? []);
    expect(text, `expected "${needle}"`).to.include(needle);
    return;
  }
  throw new Error(`expected failure "${needle}", but it succeeded`);
}

async function balance(account: PublicKey): Promise<bigint> {
  return (await getAccount(conn, account)).amount;
}

type Svc = { id: string; address: PublicKey; payeeToken: PublicKey };
let mint: PublicKey;

async function newService(price = 1n * U): Promise<Svc> {
  const id = `t-${Date.now().toString(36)}-${(n++).toString(36)}`;
  const payee = Keypair.generate();
  const payeeToken = await createAccount(conn, admin, mint, payee.publicKey);
  await asAdmin.methods.registerService(id, 'test service', bn(price)).accounts({ admin: admin.publicKey, payeeToken }).rpc();
  return { id, address: pda.service(id), payeeToken };
}

async function newTeam(fund = 100n * U) {
  const owner = Keypair.generate();
  await program.methods
    .createTeam('Test team')
    .accounts({ payer: sponsor.publicKey, owner: owner.publicKey, mint })
    .signers([owner])
    .rpc();
  const team = pda.team(owner.publicKey);
  const vault = pda.vault(mint, team);
  if (fund > 0n) await mintTo(conn, admin, mint, vault, mintAuthority, fund);
  return { owner, team, vault };
}

type Pol = { allowance: bigint; cap: bigint; maxPayments: number; periodSecs: number; expiresAt: number };
const policy = (p: Partial<Pol> = {}) => {
  const v = { allowance: 20n * U, cap: 5n * U, maxPayments: 10, periodSecs: 3600, expiresAt: now() + 3600, ...p };
  return { allowance: bn(v.allowance), cap: bn(v.cap), maxPayments: v.maxPayments, periodSecs: v.periodSecs, expiresAt: bn(v.expiresAt) };
};

async function grant(t: { owner: Keypair }, who: PublicKey, services: Svc[], p: Partial<Pol> = {}, kind: object = { agent: {} }) {
  await program.methods
    .addSpender(who, kind as never, 'spender', policy(p), services.map((s) => s.address))
    .accounts({ payer: sponsor.publicKey, owner: t.owner.publicKey })
    .signers([t.owner])
    .rpc();
  return pda.spender(pda.team(t.owner.publicKey), who);
}

function pay(t: { team: PublicKey; vault: PublicKey }, agent: Keypair, s: Svc, amount: bigint, i = intent(), payeeToken = s.payeeToken) {
  return {
    intent: i,
    send: () =>
      program.methods
        .pay(i, bn(amount), 'test')
        .accounts({
          payer: sponsor.publicKey,
          authority: agent.publicKey,
          team: t.team,
          service: s.address,
          vault: t.vault,
          payeeToken,
        } as never)
        .signers([agent])
        .rpc(),
  };
}

const paymentOf = (team: PublicKey, agent: Keypair, i: string) => pda.payment(pda.spender(team, agent.publicKey), i);
const status = (s: object) => Object.keys(s)[0];

function decide(kind: 'approve' | 'decline', t: { owner: Keypair; team: PublicKey; vault: PublicKey }, payment: PublicKey, extra: { spender: PublicKey; service: PublicKey; payeeToken: PublicKey }, signer = t.owner) {
  if (kind === 'decline') {
    return program.methods.decline().accounts({ owner: signer.publicKey, payment } as never).signers([signer]).rpc();
  }
  return program.methods
    .approve()
    .accounts({ owner: signer.publicKey, spender: extra.spender, service: extra.service, vault: t.vault, payeeToken: extra.payeeToken, payment } as never)
    .signers([signer])
    .rpc();
}

describe('rein', () => {
  before(async () => {
    const sig = await conn.requestAirdrop(sponsor.publicKey, 20 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, 'confirmed');
    mint = (await asAdmin.account.config.fetch(pda.config())).mint;
  });

  it('pays inside the policy at once, and the agent holds no SOL', async () => {
    const s = await newService();
    const t = await newTeam();
    const agent = Keypair.generate();
    expect(await conn.getBalance(agent.publicKey)).to.equal(0);
    const spender = await grant(t, agent.publicKey, [s]);
    const p = pay(t, agent, s, 3n * U);
    await p.send();
    const rec = await program.account.payment.fetch(paymentOf(t.team, agent, p.intent));
    expect(status(rec.status)).to.equal('paid');
    expect(await balance(s.payeeToken)).to.equal(3n * U);
    expect(await balance(t.vault)).to.equal(97n * U);
    const sp = await program.account.spender.fetch(spender);
    expect(sp.spent.toString()).to.equal((3n * U).toString());
    expect(sp.count).to.equal(1);
    expect(await conn.getBalance(agent.publicKey)).to.equal(0);
  });

  it('files an over-cap payment as pending, and the owner approval settles it in one tx', async () => {
    const s = await newService();
    const t = await newTeam();
    const agent = Keypair.generate();
    const spender = await grant(t, agent.publicKey, [s]);
    const p = pay(t, agent, s, 12n * U);
    await p.send();
    const payment = paymentOf(t.team, agent, p.intent);
    let rec = await program.account.payment.fetch(payment);
    expect(status(rec.status)).to.equal('pending');
    expect(decodeReasons(rec.reasons)).to.deep.equal(['over_cap']);
    expect(await balance(s.payeeToken)).to.equal(0n);
    await decide('approve', t, payment, { spender, service: s.address, payeeToken: s.payeeToken });
    rec = await program.account.payment.fetch(payment);
    expect(status(rec.status)).to.equal('settled');
    expect(await balance(s.payeeToken)).to.equal(12n * U);
    const sp = await program.account.spender.fetch(spender);
    expect(sp.spent.toString()).to.equal((12n * U).toString()); // an approval still counts against the period
  });

  it('files a service outside the allowed list as pending, with every reason that applies', async () => {
    const allowed = await newService();
    const other = await newService();
    const t = await newTeam();
    const agent = Keypair.generate();
    await grant(t, agent.publicKey, [allowed], { cap: 5n * U, allowance: 6n * U });
    const p = pay(t, agent, other, 7n * U);
    await p.send();
    const rec = await program.account.payment.fetch(paymentOf(t.team, agent, p.intent));
    expect(decodeReasons(rec.reasons)).to.deep.equal(['service_not_allowed', 'over_cap', 'over_allowance']);
  });

  it('files the payment over the count limit as pending', async () => {
    const s = await newService();
    const t = await newTeam();
    const agent = Keypair.generate();
    await grant(t, agent.publicKey, [s], { maxPayments: 1 });
    await pay(t, agent, s, 1n * U).send();
    const p = pay(t, agent, s, 1n * U);
    await p.send();
    const rec = await program.account.payment.fetch(paymentOf(t.team, agent, p.intent));
    expect(decodeReasons(rec.reasons)).to.deep.equal(['over_payment_count']);
  });

  it('pays an intent at most once', async () => {
    const s = await newService();
    const t = await newTeam();
    const agent = Keypair.generate();
    await grant(t, agent.publicKey, [s]);
    const p = pay(t, agent, s, 1n * U);
    await p.send();
    await fails(pay(t, agent, s, 1n * U, p.intent).send(), 'already in use');
    expect(await balance(s.payeeToken)).to.equal(1n * U);
  });

  it('refuses an unknown service: it has no registry account', async () => {
    const s = await newService();
    const t = await newTeam();
    const agent = Keypair.generate();
    await grant(t, agent.publicKey, [s]);
    const fake: Svc = { id: 'wallet-9xqe', address: pda.service('wallet-9xqe'), payeeToken: s.payeeToken };
    await fails(pay(t, agent, fake, 1n * U).send(), 'AccountNotInitialized');
  });

  it('refuses a payee the registry does not name', async () => {
    const s = await newService();
    const t = await newTeam();
    const agent = Keypair.generate();
    await grant(t, agent.publicKey, [s]);
    const attacker = await createAccount(conn, admin, mint, Keypair.generate().publicKey);
    await fails(pay(t, agent, s, 1n * U, intent(), attacker).send(), 'WrongPayee');
  });

  it('refuses a key that is not a spender on the team', async () => {
    const s = await newService();
    const t = await newTeam();
    await fails(pay(t, Keypair.generate(), s, 1n * U).send(), 'AccountNotInitialized');
  });

  it('only the owner approves; decline and cancel are final', async () => {
    const s = await newService();
    const t = await newTeam();
    const agent = Keypair.generate();
    const spender = await grant(t, agent.publicKey, [s]);
    const extra = { spender, service: s.address, payeeToken: s.payeeToken };

    const a = pay(t, agent, s, 9n * U);
    await a.send();
    const pa = paymentOf(t.team, agent, a.intent);
    await fails(decide('approve', t, pa, extra, Keypair.generate()), 'Error');
    await decide('decline', t, pa, extra);
    expect(status((await program.account.payment.fetch(pa)).status)).to.equal('declined');
    await fails(decide('approve', t, pa, extra), 'NotPending');

    const b = pay(t, agent, s, 9n * U);
    await b.send();
    const pb = paymentOf(t.team, agent, b.intent);
    const stranger = Keypair.generate();
    await fails(
      program.methods.cancel().accounts({ signer: stranger.publicKey, team: t.team, payment: pb } as never).signers([stranger]).rpc(),
      'NotOwnerOrFiler',
    );
    await program.methods.cancel().accounts({ signer: agent.publicKey, team: t.team, payment: pb } as never).signers([agent]).rpc();
    expect(status((await program.account.payment.fetch(pb)).status)).to.equal('cancelled');
    expect(await balance(s.payeeToken)).to.equal(0n);
  });

  it('an approval waives a budget, never a stop: revoked, re-granted or suspended refuses for good', async () => {
    const s = await newService();
    const t = await newTeam();
    const agent = Keypair.generate();
    const spender = await grant(t, agent.publicKey, [s]);
    const extra = { spender, service: s.address, payeeToken: s.payeeToken };
    const ownerSpender = { owner: t.owner.publicKey, spender } as never;

    // Revoke, then re-grant: a payment filed under generation 0 cannot settle under generation 1.
    const a = pay(t, agent, s, 9n * U);
    await a.send();
    await program.methods.revoke().accounts(ownerSpender).signers([t.owner]).rpc();
    await fails(pay(t, agent, s, 1n * U).send(), 'NotActive');
    await grant(t, agent.publicKey, [s]);
    expect((await program.account.spender.fetch(spender)).generation).to.equal(1);
    const pa = paymentOf(t.team, agent, a.intent);
    await decide('approve', t, pa, extra);
    expect(status((await program.account.payment.fetch(pa)).status)).to.equal('refused');

    // A suspended service: pay is refused, and a pending payment to it is refused at approval.
    const b = pay(t, agent, s, 9n * U);
    await b.send();
    await asAdmin.methods.setServiceActive(false).accounts({ admin: admin.publicKey, service: s.address } as never).rpc();
    await fails(pay(t, agent, s, 1n * U).send(), 'ServiceSuspended');
    const pb = paymentOf(t.team, agent, b.intent);
    await decide('approve', t, pb, extra);
    expect(status((await program.account.payment.fetch(pb)).status)).to.equal('refused');
    expect(await balance(s.payeeToken)).to.equal(0n);
  });

  it('refuses while the team or the spender is paused, and after expiry', async () => {
    const s = await newService();
    const t = await newTeam();
    const agent = Keypair.generate();
    const spender = await grant(t, agent.publicKey, [s], { expiresAt: now() + 4 });
    await program.methods.setPaused(true).accounts({ owner: t.owner.publicKey } as never).signers([t.owner]).rpc();
    await fails(pay(t, agent, s, 1n * U).send(), 'TeamPaused');
    await program.methods.setPaused(false).accounts({ owner: t.owner.publicKey } as never).signers([t.owner]).rpc();
    await program.methods.setSpenderStatus(false).accounts({ owner: t.owner.publicKey, spender } as never).signers([t.owner]).rpc();
    await fails(pay(t, agent, s, 1n * U).send(), 'NotActive');
    await program.methods.setSpenderStatus(true).accounts({ owner: t.owner.publicKey, spender } as never).signers([t.owner]).rpc();
    await sleep(6000);
    await fails(pay(t, agent, s, 1n * U).send(), 'Expired');
  });

  it('rejects a bad policy and more than 8 services', async () => {
    const s = await newService();
    const t = await newTeam(0n);
    await fails(grant(t, Keypair.generate().publicKey, [s], { cap: 30n * U, allowance: 20n * U }), 'BadPolicy');
    await fails(grant(t, Keypair.generate().publicKey, [s], { periodSecs: 30 }), 'BadPolicy');
    await fails(grant(t, Keypair.generate().publicKey, [s], { expiresAt: now() - 1 }), 'BadPolicy');
    const nine = Array.from({ length: 9 }, () => ({ ...s, address: Keypair.generate().publicKey }));
    await fails(grant(t, Keypair.generate().publicKey, nine), 'TooManyServices');
  });

  it('only the owner withdraws', async () => {
    const t = await newTeam(10n * U);
    const to = await createAccount(conn, admin, mint, Keypair.generate().publicKey);
    const stranger = Keypair.generate();
    await fails(
      program.methods.withdraw(bn(1n * U)).accounts({ owner: stranger.publicKey, team: t.team, vault: t.vault, to } as never).signers([stranger]).rpc(),
      'Error',
    );
    await program.methods.withdraw(bn(4n * U)).accounts({ owner: t.owner.publicKey, vault: t.vault, to } as never).signers([t.owner]).rpc();
    expect(await balance(to)).to.equal(4n * U);
    expect(await balance(t.vault)).to.equal(6n * U);
  });
});
