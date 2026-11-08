import { Keypair, PublicKey } from '@solana/web3.js';
import { formatUsdc, formatUsdcOrNull, parseUsdc } from './amount.ts';
import { allowanceLeft, remainingOf, rollPeriod } from './budget.ts';
import { ReinChain, SERVICE_ID_RE, type ServiceAccount } from './chain.ts';
import { describeError } from './errors.ts';
import type { PaymentEvent } from './events.ts';
import type { ToolSpec } from './groq.ts';
import { payService, type PayOutcome } from './pay.ts';
import { explainReason } from './reasons.ts';

/**
 * The model's only tools. None takes an address: the model names a registered service by id,
 * and the payee comes from the on-chain registry.
 */
export const TOOL_SPECS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'list_services',
      description: 'List the services registered on Rein: id, label, list price in USDC, and whether each is active.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_budget',
      description:
        "Read this agent's on-chain spending policy and what is left of it: allowance per period, cap per payment, spent and payments this period, period reset, expiry, allowed service ids, and remaining (the most one payment can be right now and still settle).",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pay',
      description:
        'Pay a registered service from the team vault. Inside the policy it settles at once; over a limit it is filed as Pending for the team owner to approve. You can only name a service id, never an address.',
      parameters: {
        type: 'object',
        properties: {
          service_id: { type: 'string', description: 'A registered service id from list_services, e.g. "web-search".' },
          amount_usdc: { type: 'string', description: 'Decimal USDC string with at most 6 decimals, e.g. "0.40".' },
          memo: { type: 'string', description: 'What the payment is for, at most 64 bytes.' },
        },
        required: ['service_id', 'amount_usdc', 'memo'],
        additionalProperties: false,
      },
    },
  },
];

export interface ToolContext {
  chain: ReinChain;
  team: PublicKey;
  agent: Keypair;
  sponsor: Keypair;
}

export interface ToolRun {
  result: Record<string, unknown>;
  payment?: PaymentEvent;
  outcome?: PayOutcome;
}

const iso = (t: number) => new Date(t * 1000).toISOString();

export async function listServices(ctx: ToolContext): Promise<ToolRun> {
  try {
    const services = await ctx.chain.services();
    return {
      result: {
        services: services.map((s) => ({ id: s.id, label: s.label, price_usdc: formatUsdc(s.price), active: s.active })),
      },
    };
  } catch (e) {
    return { result: { error: `could not read the service registry: ${(e as Error).message}` } };
  }
}

export async function checkBudget(ctx: ToolContext): Promise<ToolRun> {
  const { chain } = ctx;
  const [sp, team, services, clock] = await Promise.all([
    chain.spender(ctx.team, ctx.agent.publicKey).then((v) => ({ ok: true as const, v }), (e: Error) => ({ ok: false as const, e })),
    chain.team(ctx.team).then((v) => v, () => undefined),
    chain.services().then((v) => v, () => null as ServiceAccount[] | null),
    chain.now(),
  ]);
  if (!sp.ok) return { result: { error: `could not read the spender account, budget unknown: ${sp.e.message}` } };
  if (!sp.v) return { result: { error: 'this agent is not a spender on the team, so it cannot pay anything' } };
  const s = sp.v;
  const now = clock.now;
  const teamPaused = team ? team.paused : null; // unread or missing team: unknown
  const rolled = rollPeriod(s, now);
  const remaining = remainingOf(s, now, teamPaused);
  const byAddress = services ? new Map(services.map((x) => [x.address.toBase58(), x.id])) : null;
  const allowed = byAddress ? s.services.map((k) => byAddress.get(k.toBase58()) ?? 'unlisted-service') : null;
  return {
    result: {
      team: team ? team.name : null,
      team_paused: teamPaused,
      spender_status: s.status,
      allowance_usdc: formatUsdc(s.policy.allowance),
      period_secs: s.policy.periodSecs,
      cap_usdc: formatUsdc(s.policy.cap),
      spent_this_period_usdc: formatUsdc(rolled.spent),
      payments_this_period: rolled.count,
      max_payments: s.policy.maxPayments,
      period_resets_at: iso(rolled.periodStart + s.policy.periodSecs),
      expires_at: iso(s.policy.expiresAt),
      allowed_service_ids: allowed,
      allowance_left_usdc: formatUsdc(allowanceLeft(s, now)),
      remaining_usdc: formatUsdcOrNull(remaining),
      clock: clock.source,
      note: 'remaining_usdc is the most one payment can be right now and settle at once. Above it, or for a service not in allowed_service_ids, the payment is filed as Pending for the owner.',
    },
  };
}

const PAY_KEYS = new Set(['service_id', 'amount_usdc', 'memo']);

export async function pay(ctx: ToolContext, args: Record<string, unknown>, probe = false): Promise<ToolRun> {
  const serviceId = typeof args.service_id === 'string' ? args.service_id.trim() : '';
  const ignored = Object.keys(args).filter((k) => !PAY_KEYS.has(k));
  const extra = ignored.length ? { ignored_fields: ignored, ignored_note: 'pay only takes service_id, amount_usdc and memo; there is no way to name an address' } : {};
  const event = (e: Omit<PaymentEvent, 'type' | 'service'>): PaymentEvent => ({
    type: 'payment',
    service: serviceId,
    ...e,
    ...(probe ? { probe: true } : {}),
  });

  if (!serviceId) {
    const error = 'service_id is required';
    return { result: { status: 'failed', error, ...extra }, payment: event({ status: 'failed', amount: null, error }) };
  }
  let amount: bigint;
  try {
    amount = parseUsdc(args.amount_usdc);
  } catch (e) {
    const error = (e as Error).message;
    return { result: { status: 'failed', error, ...extra }, payment: event({ status: 'failed', amount: null, error }) };
  }
  const memo = typeof args.memo === 'string' ? args.memo : '';

  const o = await payService({ chain: ctx.chain, team: ctx.team, agent: ctx.agent, sponsor: ctx.sponsor, serviceId, amount, memo });
  const errorText = o.error ? describeError(o.error) : undefined;
  const payment = event({
    status: o.status,
    amount: o.amount,
    intent: o.intent,
    ...(o.signature ? { signature: o.signature } : {}),
    ...(o.payment ? { payment: o.payment.toBase58() } : {}),
    ...(o.reasons ? { reasons: o.reasons } : {}),
    ...(o.deadline ? { deadline: o.deadline } : {}),
    ...(o.unconfirmed ? { unconfirmed: true } : {}),
    ...(o.error ? { error: errorText, errorName: o.error.name, ...(o.error.code !== null ? { errorCode: o.error.code } : {}) } : {}),
  });

  const common = { service_id: serviceId, amount_usdc: formatUsdc(o.amount), ...(o.signature ? { signature: o.signature } : {}), ...extra };
  let result: Record<string, unknown>;
  if (o.status === 'paid') {
    result = { status: 'paid', ...common, note: 'settled from the team vault in this transaction' };
  } else if (o.status === 'pending' && o.unconfirmed) {
    result = { status: 'pending', unconfirmed: true, ...common, error: errorText, note: 'sent but not confirmed; it may still land. Do not pay this again.' };
  } else if (o.status === 'pending') {
    result = {
      status: 'pending',
      ...common,
      reasons: o.reasons,
      reasons_explained: o.reasons?.map(explainReason),
      approve_by: o.deadline ? iso(o.deadline) : null,
      note: 'filed for the team owner to approve; no money has moved yet',
    };
  } else if (o.status === 'refused') {
    result = {
      status: 'refused',
      ...common,
      error: errorText,
      note: o.unknownService
        ? `no service is registered under "${serviceId}"${SERVICE_ID_RE.test(serviceId) ? '' : ' (not even a valid id)'}; the program refused it on chain and nothing moved`
        : 'the program refused this payment; nothing moved',
    };
  } else {
    result = { status: 'failed', ...common, error: errorText, note: 'nothing moved' };
  }
  return { result, payment, outcome: o };
}

export async function runTool(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolRun> {
  switch (name) {
    case 'list_services':
      return listServices(ctx);
    case 'check_budget':
      return checkBudget(ctx);
    case 'pay':
      return pay(ctx, args);
    default:
      return { result: { error: `there is no tool named ${name}; use list_services, check_budget or pay` } };
  }
}
