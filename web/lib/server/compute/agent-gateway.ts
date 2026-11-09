// The compute gateway for the agent running inside this server: the same checks as the HTTP
// routes, called in process, so a web agent run needs no self-request and no REIN_GATEWAY_URL.
// The agent sends prompts only: a service that takes audio (ai-voice) answers 400 with why.

import type { ComputeGateway } from '@rein/agent';
import { parseAddress } from '@/lib/chain';
import { isComputeService, quote, result, run, SERVICE_TABLE, type Deps } from './core';

export function inProcessGateway(deps: Deps): ComputeGateway {
  return {
    quote: async (a) => {
      const team = parseAddress(a.team);
      const authority = parseAddress(a.authority);
      if (!team || !authority) return { status: 400, body: { ok: false, error: 'bad team or authority' } };
      if (!isComputeService(a.service)) return { status: 400, body: { ok: false, error: `service must be one of: ${Object.keys(SERVICE_TABLE).join(', ')}` } };
      if (SERVICE_TABLE[a.service].input === 'audio') return { status: 400, body: { ok: false, error: `${a.service} takes an audio upload; buy it from the Compute page, not by prompt` } };
      return quote(deps, { team, authority, service: a.service, prompt: a.prompt });
    },
    run: (intent) => run(deps, intent),
    result: (intent) => result(deps, intent),
  };
}
