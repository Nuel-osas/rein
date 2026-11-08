// Invite links with no server behind them. A Rein team has one owner, and the owner adds a spender
// by wallet address, so an invite only has to carry which team and the name the owner chose:
//
//   owner  → /app/invite/<base64url {"team","label"}>    (nothing secret: anyone holding it learns
//                                                         the team address and a name, both public)
//   invitee signs in with Google, gets an embedded wallet, and sends back
//          → /app/<team>/spenders/new?authority=<wallet>&label=<name>
//   owner opens that, checks the address with the person, and grants a policy on chain.
//
// Nothing is stored and nothing is signed until the owner presses Grant. Decoding fails closed: a
// token that is not exactly a valid team address and a valid label is no invite at all.

import {parseAddress} from './chain';
import {checkLabel} from './rein';

export type Invite = {team: string; label: string};

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', {fatal: true});

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{1,400}$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Null when the team or the label would not be accepted, so a bad link is never made. */
export function encodeInvite(i: Invite): string | null {
  const team = parseAddress(i.team);
  const label = i.label.trim();
  if (!team || checkLabel(label)) return null;
  return toBase64Url(enc.encode(JSON.stringify({team, label})));
}

export function decodeInvite(token: string | null | undefined): Invite | null {
  if (!token) return null;
  const bytes = fromBase64Url(token.trim());
  if (!bytes) return null;
  try {
    const v = JSON.parse(dec.decode(bytes)) as unknown;
    if (!v || typeof v !== 'object') return null;
    const {team, label} = v as {team?: unknown; label?: unknown};
    if (typeof team !== 'string' || typeof label !== 'string') return null;
    const t = parseAddress(team);
    const l = label.trim();
    if (!t || checkLabel(l)) return null;
    return {team: t, label: l};
  } catch {
    return null;
  }
}

export function inviteLink(origin: string, token: string): string {
  return `${origin}/app/invite/${token}`;
}

/** The link the invitee sends back: the owner's add-a-person form, filled in. */
export function replyLink(origin: string, team: string, authority: string, label: string): string {
  const q = new URLSearchParams({authority, label: label.trim()});
  return `${origin}/app/${team}/spenders/new?${q.toString()}`;
}

/**
 * What someone pasted on Join a team: an invite (link or bare token) or a reply link meant for the
 * owner. Anything else is null.
 */
export function readPasted(input: string): {kind: 'invite'; token: string; invite: Invite} | {kind: 'reply'; path: string} | null {
  const s = input.trim();
  if (!s) return null;
  let path = s;
  let search = '';
  try {
    const u = new URL(s);
    path = u.pathname;
    search = u.search;
  } catch {
    // not a URL: a bare token, or a path
  }
  const inv = path.match(/(?:^|\/)app\/invite\/([A-Za-z0-9_-]+)\/?$/);
  const token = inv ? inv[1] : /^[A-Za-z0-9_-]+$/.test(path) ? path : null;
  if (token) {
    const invite = decodeInvite(token);
    if (invite) return {kind: 'invite', token, invite};
  }
  const reply = path.match(/(?:^|\/)app\/([1-9A-HJ-NP-Za-km-z]{32,44})\/spenders\/new\/?$/);
  if (reply && parseAddress(reply[1])) {
    const q = new URLSearchParams(search);
    const authority = parseAddress(q.get('authority'));
    if (authority) return {kind: 'reply', path: `/app/${reply[1]}/spenders/new?${new URLSearchParams({authority, label: (q.get('label') ?? '').trim()}).toString()}`};
  }
  return null;
}
