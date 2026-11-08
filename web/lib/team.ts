'use client';

// Reads one team from chain on an interval. Every component that shows the same team shares one
// poller (the sidebar badge and the team view never disagree, and the RPC sees one set of reads).
// Each part that fails to read is null, which the UI shows as unknown, never zero.

import { useCallback, useEffect, useState } from 'react';
import { connection } from './chain';
import { emptyTeamState, loadTeam, readServices, type Service, type TeamState } from './rein';

type Entry = { state: TeamState; subs: Set<(s: TeamState) => void>; timer: ReturnType<typeof setInterval> | null; inflight: Promise<void> | null; interval: number };

const store = new Map<string, Entry>();

function entry(team: string): Entry {
  let e = store.get(team);
  if (!e) {
    e = { state: emptyTeamState, subs: new Set(), timer: null, inflight: null, interval: 2000 };
    store.set(team, e);
  }
  return e;
}

async function refresh(team: string): Promise<void> {
  const e = entry(team);
  if (e.inflight) return e.inflight;
  e.inflight = loadTeam(connection(), team)
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

export function useTeam(team: string | null, intervalMs = 2000) {
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
      e.timer = setInterval(() => refresh(team), intervalMs);
    }
    refresh(team);
    return () => {
      e.subs.delete(setState);
      if (e.subs.size === 0 && e.timer) {
        clearInterval(e.timer);
        e.timer = null;
        e.interval = 2000;
      }
    };
  }, [team, intervalMs]);

  const again = useCallback(() => (team ? refresh(team) : Promise.resolve()), [team]);
  return { ...state, refresh: again };
}

/** The service registry, read once a minute. */
export function useServices(): Service[] | null | undefined {
  const [services, setServices] = useState<Service[] | null | undefined>(undefined);
  useEffect(() => {
    let stop = false;
    const load = () => readServices(connection()).then((s) => !stop && setServices(s));
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
