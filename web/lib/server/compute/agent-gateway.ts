// The compute gateway for the agent running inside this server: the same checks as the HTTP
// routes, called in process, so a web agent run needs no self-request and no REIN_GATEWAY_URL.

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
      const max = SERVICE_TABLE[a.service].maxPromptChars;
      if (typeof a.prompt !== 'string' || !a.prompt.trim() || a.prompt.length > max) return { status: 400, body: { ok: false, error: `prompt must be 1 to ${max} characters` } };
      return quote(deps, { team, authority, service: a.service, prompt: a.prompt });
    },
    run: (intent) => run(deps, intent),
    result: (intent) => result(deps, intent),
  };
}
