#!/usr/bin/env node
// Checks the repo's docs against the repo itself. For every Markdown file and llms.txt that git
// tracks (or would track, if it is new and not ignored):
//   1. every relative link points at a file or directory in the repo
//   2. every line reference (path#L12, path#L12-L20, path:12, path:12-20) points at lines that exist
//   3. every repo path written in backticks exists
// "In the repo" means tracked by git, or untracked but not ignored, so a reference to a gitignored
// file (a local key, a build output) fails: a fresh clone would not have it.
// Fenced code blocks are skipped: the commands in them are not references.
// A link starting with "/" is a site route (/demo, /docs/...), not a repo path, and is skipped.
//
//   node scripts/check-docs.mjs            check every doc
//   node scripts/check-docs.mjs a.md b.md  check only these files (a file outside the repo resolves
//                                          its relative paths from the repo root)
//
// Prints each failure as file:line: message, then a summary, and exits 1 when there is any failure.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const posix = path.posix;

// Docs kept as their upstream wrote them, whose references point at the upstream repo's layout.
// Keep this list short and say why for each entry.
const IGNORE = new Set([]);
// Single references inside a doc that name a file in the upstream repo, not this one. The rest of
// the doc is still checked.
const UPSTREAM_REFS = new Map([]);
const upstreamSkipped = [];
const isUpstream = (display, where, ref) => {
  if (!UPSTREAM_REFS.get(display)?.has(ref)) return false;
  upstreamSkipped.push(`${where}: ${ref}`);
  return true;
};

/** Extensions that make a token look like a repo file. */
const EXT = new Set([
  'rs', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'mts', 'cjs', 'cts', 'json', 'md', 'toml', 'sql',
  'yaml', 'yml', 'txt', 'css', 'html', 'sh', 'lock', 'svg', 'png', 'so',
]);

/** A path that is meant to be created by the reader, so it is not expected to exist. */
const MAY_BE_MISSING = /(^|\/)\.env(\.[\w-]+)?$/;

// ------------------------------------------------------------------------ the repo ---

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const repoFiles = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  .split('\0')
  .filter((f) => f && existsSync(path.join(ROOT, f)));
const fileSet = new Set(repoFiles);
const dirSet = new Set(['']);
/** dir -> names directly inside it (files and directories), from the git file list. */
const entries = new Map();
for (const f of repoFiles) {
  const parts = f.split('/');
  let dir = '';
  for (let i = 0; i < parts.length; i++) {
    if (!entries.has(dir)) entries.set(dir, new Set());
    entries.get(dir).add(parts[i]);
    if (i < parts.length - 1) {
      dir = dir ? `${dir}/${parts[i]}` : parts[i];
      dirSet.add(dir);
    }
  }
}
const topEntries = entries.get('') ?? new Set();

/** A repo-relative path, or null when it leaves the repo. */
function normalize(p) {
  let n = posix.normalize(p).replace(/\/+$/, '');
  if (n === '.' || n === '') return '';
  if (n === '..' || n.startsWith('../')) return null;
  return n.replace(/^\.\//, '');
}
const resolveFrom = (baseDir, p) => normalize(posix.join(baseDir, p));
const exists = (rel) => rel !== null && (fileSet.has(rel) || dirSet.has(rel));
const isFile = (rel) => rel !== null && fileSet.has(rel);

const lineCache = new Map();
function lineCount(rel) {
  if (!lineCache.has(rel)) {
    const lines = readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    lineCache.set(rel, lines.length);
  }
  return lineCache.get(rel);
}

const extOf = (p) => {
  const m = /\.([A-Za-z0-9]+)$/.exec(p);
  return m ? m[1].toLowerCase() : '';
};

// ----------------------------------------------------------------------- parsing ---

/** Inline code spans with their positions. */
function codeSpans(line) {
  const out = [];
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(line))) out.push({ text: m[1], start: m.index, end: m.index + m[0].length });
  return out;
}

/** The line with code-span contents masked (same length), so links inside backticks are ignored. */
function maskSpans(line, spans) {
  let out = line;
  for (const s of spans) out = out.slice(0, s.start + 1) + 'x'.repeat(s.end - s.start - 2) + out.slice(s.end - 1);
  return out;
}

/** Inline link targets `](target)` (balanced parentheses, optional <...>), and reference definitions. */
function linkTargets(masked) {
  const out = [];
  let i = 0;
  while ((i = masked.indexOf('](', i)) !== -1) {
    const start = i + 2;
    // Where the link text opens, so the whole [text](target) can be kept out of the prose scan:
    // the text is often a short label such as "lib.rs#L12" for the target that is checked.
    let open = i - 1;
    for (let depth = 0; open >= 0; open--) {
      if (masked[open] === ']') depth++;
      else if (masked[open] === '[') {
        if (depth === 0) break;
        depth--;
      }
    }
    const textStart = open >= 0 ? open : i;
    if (masked[start] === '<') {
      const k = masked.indexOf('>', start);
      if (k === -1) {
        i = start;
        continue;
      }
      out.push({ target: masked.slice(start + 1, k), start, end: k + 1, textStart });
      i = k;
      continue;
    }
    let j = start;
    let depth = 0;
    for (; j < masked.length; j++) {
      const c = masked[j];
      if (c === '(') depth++;
      else if (c === ')') {
        if (depth === 0) break;
        depth--;
      } else if (c === ' ' || c === '\t') break;
    }
    out.push({ target: masked.slice(start, j), start, end: j, textStart });
    i = j;
  }
  const def = /^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/.exec(masked);
  if (def) {
    const at = masked.indexOf(def[1]);
    out.push({ target: def[1], start: at, end: at + def[1].length, textStart: at });
  }
  return out;
}

const PATH_CHARS = String.raw`[\w@.\-/()\[\]]`;
const BEFORE = String.raw`(?<![\w@./:\-])`;
/** path.ext:12 or path.ext:12-20 */
const COLON_REF = new RegExp(String.raw`${BEFORE}(${PATH_CHARS}+\.[A-Za-z0-9]+):(\d+)(?:-(\d+))?(?!\w)`, 'g');
/** path.ext#L12 or path.ext#L12-L20 (outside link targets) */
const HASH_REF = new RegExp(String.raw`${BEFORE}(${PATH_CHARS}+\.[A-Za-z0-9]+)#L(\d+)(?:-L?(\d+))?(?!\w)`, 'g');

/** Drops leading ( or [ that a path picked up from the surrounding prose. */
function trimLead(p) {
  let s = p;
  const count = (str, c) => str.split(c).length - 1;
  while ((s.startsWith('(') && count(s, '(') > count(s, ')')) || (s.startsWith('[') && count(s, '[') > count(s, ']'))) s = s.slice(1);
  return s;
}

// ------------------------------------------------------------------------- checks ---

const failures = [];
const stats = { files: 0, links: 0, lineRefs: 0, paths: 0 };
/** References already checked on the current line: a link's text often repeats its target. */
let seen = new Set();

function checkRange(where, rel, from, to, label) {
  const key = `${rel}:${from}-${to ?? from}`;
  if (seen.has(key)) return;
  seen.add(key);
  stats.lineRefs++;
  const n = lineCount(rel);
  const a = Number(from);
  const b = to === undefined ? a : Number(to);
  if (a < 1 || b < a || b > n) failures.push(`${where}: ${label} points past the end of ${rel} (${n} lines)`);
}

/** A path:nn style reference, resolved from the repo root first, then the doc's own directory. */
function checkLineRef(where, dir, rawPath, from, to, label) {
  const p = trimLead(rawPath);
  if (!EXT.has(extOf(p))) return;
  const relative = p.startsWith('./') || p.startsWith('../');
  const candidates = relative ? [resolveFrom(dir, p)] : [normalize(p), resolveFrom(dir, p)];
  const rel = candidates.find(isFile);
  if (!rel) {
    if (seen.has(`missing:${p}`)) return;
    seen.add(`missing:${p}`);
    stats.lineRefs++;
    failures.push(`${where}: ${label} names a file that is not in the repo: ${p}`);
    return;
  }
  checkRange(where, rel, from, to, label);
}

function checkDoc(display, dir, text) {
  stats.files++;
  const lines = text.split('\n');
  let fence = null;
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const where = `${display}:${idx + 1}`;
    seen = new Set();
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const spans = codeSpans(line);
    const masked = maskSpans(line, spans);
    const links = linkTargets(masked);

    // 1. relative links (and their #Lnn line anchors)
    for (const l of links) {
      let target = l.target.trim();
      if (!target || target.startsWith('#') || target.startsWith('/')) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const hash = target.indexOf('#');
      const anchor = hash === -1 ? '' : target.slice(hash + 1);
      target = (hash === -1 ? target : target.slice(0, hash)).replace(/\?.*$/, '');
      if (!target) continue;
      try {
        target = decodeURIComponent(target);
      } catch {
        /* keep it as written */
      }
      if (isUpstream(display, where, target)) continue;
      stats.links++;
      const base = resolveFrom(dir, target);
      // The site's docs renderer resolves page links without the .md, so try those forms too.
      const rel = [base, base === null ? null : `${base}.md`, base === null ? null : `${base}/README.md`].find(exists) ?? null;
      if (rel === null) {
        failures.push(`${where}: broken link: ${l.target} (not in the repo)`);
        continue;
      }
      const m = /^L(\d+)(?:-L?(\d+))?$/.exec(anchor);
      if (m) {
        if (!isFile(rel)) failures.push(`${where}: line anchor on a directory: ${l.target}`);
        else checkRange(where, rel, m[1], m[2], l.target);
      }
    }

    // 2. inline line references, outside links (a link's target is checked above)
    let prose = line;
    for (const l of links) prose = prose.slice(0, l.textStart) + ' '.repeat(l.end - l.textStart) + prose.slice(l.end);
    for (const re of [COLON_REF, HASH_REF]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(prose))) checkLineRef(where, dir, m[1], m[2], m[3], m[0]);
    }

    // 3. repo paths in backticks
    for (const s of spans) {
      const t = s.text.trim();
      if (!t || /\s/.test(t)) continue;
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) continue;
      if (/^[~$@\-/]/.test(t)) continue;
      // A trailing line reference is checked above.
      if (/(:\d+(-\d+)?|#L\d+(-L?\d+)?)$/.test(t)) continue;
      const p = t.replace(/#.*$/, '');
      if (!p.includes('/') && !EXT.has(extOf(p))) continue;
      let bases;
      if (p.startsWith('./') || p.startsWith('../')) bases = [dir];
      else {
        const first = p.split('/')[0];
        const inRoot = topEntries.has(first);
        const inDir = entries.get(dir)?.has(first) ?? false;
        if (!inRoot && !inDir) continue;
        bases = inRoot ? ['', dir] : [dir, ''];
      }
      const found = bases.some((b) => exists(resolveFrom(b, p)));
      // Globs, placeholders and route segments are checked only when the literal path exists.
      if (/[*<>{}[\]…]/.test(p)) {
        if (found) stats.paths++;
        continue;
      }
      if (MAY_BE_MISSING.test(p) || isUpstream(display, where, p)) continue;
      stats.paths++;
      if (!found) failures.push(`${where}: path in backticks is not in the repo: ${t}`);
    }
  }
}

// --------------------------------------------------------------------------- main ---

const args = process.argv.slice(2).filter((a) => a !== '--');
const targets = args.length
  ? args.map((a) => path.resolve(process.cwd(), a))
  : repoFiles.filter((f) => f.endsWith('.md') || posix.basename(f) === 'llms.txt').map((f) => path.join(ROOT, f));

const skipped = [];
for (const abs of targets) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  const inside = !rel.startsWith('..') && !path.isAbsolute(rel);
  if (inside && IGNORE.has(rel)) {
    skipped.push(rel);
    continue;
  }
  if (!existsSync(abs)) {
    failures.push(`${inside ? rel : abs}: no such file`);
    continue;
  }
  checkDoc(inside ? rel : abs, inside ? posix.dirname(rel).replace(/^\.$/, '') : '', readFileSync(abs, 'utf8'));
}

for (const s of skipped) console.log(`skipped (IGNORE): ${s}`);
for (const s of upstreamSkipped) console.log(`skipped (upstream reference): ${s}`);
for (const f of failures) console.log(f);
console.log(
  `docs:check: ${stats.files} files, ${stats.links} links, ${stats.lineRefs} line refs, ${stats.paths} paths checked, ${failures.length} failures`,
);
process.exit(failures.length ? 1 : 0);
