'use client';

// Reads one team from chain on an interval. Every component that shows the same team shares one
// poller (the sidebar badge and the team view never disagree, and the RPC sees one set of reads).
// Each part that fails to read is null, which the UI shows as unknown, never zero.

import { useCallback, useEffect, useState } from 'react';
import { emptyTeamState, type Service, type TeamState } from './rein';
import { fromWire } from './wire';

// Browsers read through the server's shared cache (/api/team/<team>/state), never the RPC directly:
// devnet's public RPC rate-limits getProgramAccounts per IP, and a poller per visitor tripped it.
const MIN_INTERVAL_MS = 5_000;

async function fetchTeam(team: string, fresh: boolean): Promise<TeamState> {
  const r = await fetch(`/api/team/${encodeURIComponent(team)}/state${fresh ? '?fresh=1' : ''}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`team state ${r.status}`);
  const body = fromWire<{ ok: boolean; state: TeamState }>(await r.text());
  if (!body.ok) throw new Error('team state refused');
  return body.state;
}

type Entry = { state: TeamState; subs: Set<(s: TeamState) => void>; timer: ReturnType<typeof setInterval> | null; inflight: Promise<void> | null; interval: number };

const store = new Map<string, Entry>();

function entry(team: string): Entry {
  let e = store.get(team);
  if (!e) {
    e = { state: emptyTeamState, subs: new Set(), timer: null, inflight: null, interval: MIN_INTERVAL_MS };
    store.set(team, e);
  }
  return e;
}

async function refresh(team: string, fresh = false): Promise<void> {
  const e = entry(team);
  if (e.inflight) return e.inflight;
  e.inflight = fetchTeam(team, fresh)
    .then((state) => {
      e.state = state;
      e.subs.forEach((f) => f(state));
    })
    .catch(() => {
      // loadTeam settles every part itself; anything else leaves the last state in place.
    })
    .finally(() => {
      e.inflight = null;
    });
  return e.inflight;
}

export function useTeam(team: string | null, requestedMs = MIN_INTERVAL_MS) {
  const intervalMs = Math.max(requestedMs, MIN_INTERVAL_MS);
  const [state, setState] = useState<TeamState>(() => (team ? entry(team).state : emptyTeamState));

  useEffect(() => {
    if (!team) {
      setState(emptyTeamState);
      return;
    }
    const e = entry(team);
    setState(e.state);
    e.subs.add(setState);
    if (!e.timer || intervalMs < e.interval) {
      if (e.timer) clearInterval(e.timer);
      e.interval = intervalMs;
      // A hidden tab stops polling; it catches up on the next tick after it is shown.
      e.timer = setInterval(() => {
        if (typeof document === 'undefined' || !document.hidden) void refresh(team);
      }, intervalMs);
    }
    refresh(team);
    return () => {
      e.subs.delete(setState);
      if (e.subs.size === 0 && e.timer) {
        clearInterval(e.timer);
        e.timer = null;
        e.interval = MIN_INTERVAL_MS;
      }
    };
  }, [team, intervalMs]);

  // After an action the caller wants the new state now, so this skips the server's freshness window.
  const again = useCallback(() => (team ? refresh(team, true) : Promise.resolve()), [team]);
  return { ...state, refresh: again };
}

/** The service registry, read once a minute. */
export function useServices(): Service[] | null | undefined {
  const [services, setServices] = useState<Service[] | null | undefined>(undefined);
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch('/api/services', { cache: 'no-store' })
        .then(async (r) => fromWire<{ services: Service[] | null }>(await r.text()).services)
        .catch(() => null)
        .then((s) => !stop && setServices(s));
    load();
    const t = setInterval(load, 60_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  return services;
}

/** Seconds since the epoch, ticking once a second, for countdowns and rolled periods. */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
