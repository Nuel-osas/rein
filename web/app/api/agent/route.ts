// Runs Rein's buying agent and streams what it does, one JSON event per line.
//   POST { scenario: "research" | "overspend" | "injection" }  or  { task: "<plain words>" }
//   optional { team }: run as that team's agent. Needs `Authorization: Bearer <Privy token>` of a
//   user whose linked Solana wallet owns the team. Without `team`, the demo team runs, as before.
// The agent signs with the team's agent key (a Spender with no money and no SOL): the demo agent's
// key for the demo team, else the key derived from REIN_AGENT_SEED for that team. The sponsor pays
// fees and rent. The program decides whether each payment settles, waits for the owner, or is
// refused. Only server-held keys, rate-limited because every run spends devnet SOL, the agent's
// budget and model credits. With the compute gateway configured the agent can also buy 0G runs.

import { runAgent, SCENARIOS, isScenarioId, eventToJSON } from '@rein/agent';
import { inProcessGateway } from '@/lib/server/compute/agent-gateway';
import { computeDeps } from '@/lib/server/compute/wire';
import { serverKey } from '@/lib/server/keys';
import { serverConnection } from '@/lib/server/send';
import { teamAgent } from '@/lib/server/team-agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TASK_MAX = 500;
const fail = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  let body: { scenario?: unknown; task?: unknown; team?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > 2048) return fail('request too large', 413);
    body = JSON.parse(raw);
  } catch {
    return fail('bad json');
  }
  if (!body || typeof body !== 'object') return fail('bad request');

  let task: string;
  let probe = undefined;
  if (typeof body.scenario === 'string') {
    if (!isScenarioId(body.scenario)) return fail('scenario must be research, overspend or injection');
    const s = SCENARIOS[body.scenario];
    task = s.task;
    probe = s.probe;
  } else if (typeof body.task === 'string' && body.task.trim()) {
    task = body.task.trim().slice(0, TASK_MAX);
  } else {
    return fail('send a scenario or a task');
  }

  // The demo team for anyone (rate-limited), another team only for its owner (lib/server/team-agent.ts).
  const who = await teamAgent(req, body.team, 'agent');
  if (!who.ok) return fail(who.error, who.status);
  const { team, agent } = who;
  const sponsor = serverKey('sponsor');
  if (!sponsor) return fail('The sponsor key is not configured on this server.', 503);
  if (!process.env.GROQ_API_KEY) return fail('The model key is not configured on this server.', 503);
  // Compute is optional: without a store the agent runs with its three original tools.
  const deps = computeDeps();
  const compute = deps ? inProcessGateway(deps) : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (line: string) => controller.enqueue(encoder.encode(line + '\n'));
      try {
        for await (const event of runAgent({
          task,
          probe,
          connection: serverConnection(),
          team,
          agent,
          sponsor,
          compute,
          signal: req.signal,
        })) {
          write(eventToJSON(event));
        }
      } catch (e) {
        // A crash mid-run is reported as such. Any payment already sent was streamed above.
        write(JSON.stringify({ type: 'final', text: 'The agent stopped unexpectedly. Payments already shown above are on chain.', error: String(e).slice(0, 200) }));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
  });
}
