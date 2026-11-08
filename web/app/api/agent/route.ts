// Runs Rein's buying agent for the demo team and streams what it does, one JSON event per line.
//   POST { scenario: "research" | "overspend" | "injection" }  or  { task: "<plain words>" }
// The agent signs with the demo agent's key (a Spender with no money and no SOL); the sponsor pays
// fees and rent. The program decides whether each payment settles, waits for the owner, or is refused.
// Only the demo team, only server-held keys, and rate-limited per IP because every run spends
// devnet SOL, the agent's budget and model credits.

import { runAgent, SCENARIOS, isScenarioId, eventToJSON } from '@rein/agent';
import { DEMO_TEAM } from '@/lib/chain';
import { serverKey } from '@/lib/server/keys';
import { allow, tooMany } from '@/lib/server/limit';
import { serverConnection } from '@/lib/server/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TASK_MAX = 500;
const fail = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  let body: { scenario?: unknown; task?: unknown };
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

  if (!allow('agent', req, 6, 10 * 60_000)) return tooMany();
  const team = DEMO_TEAM;
  if (!team) return fail('No demo team is configured on this server.', 503);
  const agent = serverKey('demoAgent');
  const sponsor = serverKey('sponsor');
  if (!agent || !sponsor) return fail('The demo agent or sponsor key is not configured on this server.', 503);
  if (!process.env.GROQ_API_KEY) return fail('The model key is not configured on this server.', 503);

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
