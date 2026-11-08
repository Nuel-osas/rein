import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fromWire, toWire } from '../wire';
import { mergeStale } from './team-cache';
import { emptyTeamState, type TeamState } from '../rein';

describe('wire', () => {
  it('round-trips bigints exactly, including ones past 2^53', () => {
    const v = { a: 2n ** 70n, b: [1n, { c: -5n }], d: 'x', e: null };
    assert.deepEqual(fromWire(toWire(v)), v);
  });
  it('leaves look-alike objects with other keys alone', () => {
    assert.deepEqual(fromWire(toWire({ o: { $bigint: '1', other: 2 } })), { o: { $bigint: '1', other: 2 } });
  });
});

describe('mergeStale', () => {
  const prev: TeamState = { ...emptyTeamState, balance: 5n, spenders: [], payments: [], at: 1 };
  it('keeps the last good value of a part that failed, and names it', () => {
    const next: TeamState = { ...emptyTeamState, balance: 7n, spenders: null, payments: [], at: 2 };
    const r = mergeStale(next, prev);
    assert.equal(r.state.balance, 7n);
    assert.deepEqual(r.state.spenders, []);
    assert.deepEqual(r.stale, ['spenders']);
  });
  it('never revives data for a team that is now missing', () => {
    const next: TeamState = { ...emptyTeamState, missing: true, at: 2 };
    assert.deepEqual(mergeStale(next, prev).stale, []);
  });
  it('leaves a part that never read as unknown (null)', () => {
    const r = mergeStale({ ...emptyTeamState, at: 2 }, null);
    assert.equal(r.state.spenders, null);
  });
});
