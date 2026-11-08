/* ===========================================================================
   The docs' markdown, parsed into a small tree the page renders as React.

   The docs at /docs are GitBook-style markdown (content/docs), so they use
   GitBook's blocks as well as plain markdown. This parser covers exactly what
   those files use, and nothing else:

     headings, paragraphs, bullet and numbered lists, GFM tables, fenced code,
     block quotes, **bold**, *italic*, `code`, [links](...),
     {% hint %}, {% tabs %} / {% tab %}, {% stepper %} / {% step %},
     <details> / <summary>, and a front-matter `description:`.

   It returns data, never HTML, so the page renders through React and nothing
   is injected as markup. A construct it does not know is kept as plain text,
   so a typo shows up on the page instead of disappearing. Pure: no I/O.
   =========================================================================== */

export type Inline =
  | {t: "text"; v: string}
  | {t: "strong"; c: Inline[]}
  | {t: "em"; c: Inline[]}
  | {t: "code"; v: string}
  | {t: "link"; href: string; c: Inline[]};

export type HintStyle = "info" | "warning" | "success" | "danger";

/** A Mermaid block drawn ahead of time (scripts/render-docs-diagrams.mjs), set by the loader. */
export interface Diagram {
  src: string;
  width: number;
  height: number;
}

export type Block =
  | {t: "heading"; level: 2 | 3 | 4; id: string; c: Inline[]; text: string}
  | {t: "p"; c: Inline[]}
  | {t: "ul"; items: Inline[][]}
  | {t: "ol"; start: number; items: Inline[][]}
  | {t: "table"; head: Inline[][]; rows: Inline[][][]}
  | {t: "code"; lang: string; v: string; diagram?: Diagram}
  | {t: "quote"; c: Block[]}
  | {t: "hint"; style: HintStyle; c: Block[]}
  | {t: "tabs"; tabs: {title: string; c: Block[]}[]}
  | {t: "stepper"; steps: Block[][]}
  | {t: "details"; summary: Inline[]; c: Block[]};

export interface ParsedPage {
  title: string;
  description: string;
  blocks: Block[];
}

// --- Inline ----------------------------------------------------------------------------------------------

/** Parse one line or paragraph of inline markdown. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({t: "text", v: text});
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    // An escaped character is itself.
    if (ch === "\\" && i + 1 < src.length && /[\\`*_[\]()#|<>!-]/.test(src[i + 1])) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({t: "code", v: src.slice(i + 1, end)});
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const close = matchBracket(src, i);
      if (close > i && src[close + 1] === "(") {
        const end = src.indexOf(")", close + 2);
        if (end > close) {
          flush();
          out.push({t: "link", href: src.slice(close + 2, end).trim(), c: parseInline(src.slice(i + 1, close))});
          i = end + 1;
          continue;
        }
      }
    }
    if (ch === "*" && src[i + 1] === "*") {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({t: "strong", c: parseInline(src.slice(i + 2, end))});
        i = end + 2;
        continue;
      }
    }
    if (ch === "*" && src[i + 1] !== " ") {
      const end = src.indexOf("*", i + 1);
      if (end > i + 1 && src[end - 1] !== " ") {
        flush();
        out.push({t: "em", c: parseInline(src.slice(i + 1, end))});
        i = end + 1;
        continue;
      }
    }
    text += ch;
    i += 1;
  }
  flush();
  return out;
}

/** The index of the `]` closing the `[` at `open`, allowing nested brackets; -1 if none. */
function matchBracket(src: string, open: number): number {
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === "\\") {
      k++;
      continue;
    }
    if (src[k] === "[") depth++;
    else if (src[k] === "]" && --depth === 0) return k;
  }
  return -1;
}

/** The plain text of inline content, for ids and titles. */
export function inlineText(c: Inline[]): string {
  return c.map((n) => (n.t === "text" || n.t === "code" ? n.v : inlineText(n.c))).join("");
}

/**
 * GitHub's heading anchors, which the docs' links were written against: lower case, punctuation
 * dropped, each space a hyphen. "Solana devnet (2026)" becomes "solana-devnet-2026".
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

// --- Blocks -----------------------------------------------------------------------------------------------

const OPENERS: Record<string, string> = {hint: "endhint", tabs: "endtabs", tab: "endtab", stepper: "endstepper", step: "endstep"};

/** `{% name attrs %}` on its own line, or null. */
function tag(line: string): {name: string; attrs: Record<string, string>} | null {
  const m = /^\s*\{%\s*([a-z]+)((?:\s+[a-z]+="[^"]*")*)\s*%\}\s*$/.exec(line);
  if (!m) return null;
  const attrs: Record<string, string> = {};
  for (const a of m[2].matchAll(/([a-z]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
  return {name: m[1], attrs};
}

/** The line index of the tag closing the block opened at `start`, counting nested blocks of the same kind. */
function findClose(lines: string[], start: number, open: string, close: string): number {
  let depth = 0;
  for (let k = start; k < lines.length; k++) {
    const t = tag(lines[k]);
    if (t?.name === open) depth++;
    else if (t?.name === close && --depth === 0) return k;
  }
  return lines.length;
}

function findDetailsClose(lines: string[], start: number): number {
  let depth = 0;
  for (let k = start; k < lines.length; k++) {
    if (/^\s*<details>\s*$/.test(lines[k])) depth++;
    else if (/^\s*<\/details>\s*$/.test(lines[k]) && --depth === 0) return k;
  }
  return lines.length;
}

const BULLET = /^\s*[*-]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)\.\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (let k = 0; k < body.length; k++) {
    if (body[k] === "\\" && body[k + 1] === "|") {
      cur += "|";
      k++;
    } else if (body[k] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += body[k];
  }
  cells.push(cur.trim());
  return cells;
}

/** True when a line starts a block other than a paragraph, so a paragraph ends before it. */
function startsBlock(lines: string[], k: number): boolean {
  const line = lines[k];
  return (
    /^#{1,6}\s/.test(line) ||
    /^```/.test(line) ||
    /^>\s?/.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    tag(line) !== null ||
    /^\s*<\/?details>\s*$/.test(line) ||
    (line.trim().startsWith("|") && k + 1 < lines.length && TABLE_SEPARATOR.test(lines[k + 1]))
  );
}

/** Parse a run of lines into blocks. `ids` keeps heading anchors unique across the page. */
export function parseBlocks(lines: string[], ids: Map<string, number> = new Map()): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const t = tag(line);
    if (t && OPENERS[t.name]) {
      const end = findClose(lines, i, t.name, OPENERS[t.name]);
      const inner = lines.slice(i + 1, end);
      if (t.name === "hint") {
        const style = (["info", "warning", "success", "danger"] as const).find((s) => s === t.attrs.style) ?? "info";
        out.push({t: "hint", style, c: parseBlocks(inner, ids)});
      } else if (t.name === "tabs") {
        const tabs: {title: string; c: Block[]}[] = [];
        for (let k = 0; k < inner.length; k++) {
          const tt = tag(inner[k]);
          if (tt?.name === "tab") {
            const e = findClose(inner, k, "tab", "endtab");
            tabs.push({title: tt.attrs.title ?? "", c: parseBlocks(inner.slice(k + 1, e), ids)});
            k = e;
          }
        }
        out.push({t: "tabs", tabs});
      } else if (t.name === "stepper") {
        const steps: Block[][] = [];
        for (let k = 0; k < inner.length; k++) {
          if (tag(inner[k])?.name === "step") {
            const e = findClose(inner, k, "step", "endstep");
            steps.push(parseBlocks(inner.slice(k + 1, e), ids));
            k = e;
          }
        }
        out.push({t: "stepper", steps});
      } else {
        // A stray tab or step outside its parent: render its content plainly.
        out.push(...parseBlocks(inner, ids));
      }
      i = end + 1;
      continue;
    }

    if (/^\s*<details>\s*$/.test(line)) {
      const end = findDetailsClose(lines, i);
      const inner = lines.slice(i + 1, end);
      const s = inner.findIndex((l) => /<summary>.*<\/summary>/.test(l));
      const summary = s >= 0 ? inner[s].replace(/.*<summary>(.*)<\/summary>.*/, "$1").trim() : "Details";
      out.push({t: "details", summary: parseInline(summary), c: parseBlocks(s >= 0 ? inner.slice(s + 1) : inner, ids)});
      i = end + 1;
      continue;
    }

    const fence = /^```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      let end = i + 1;
      while (end < lines.length && !/^```\s*$/.test(lines[end])) end++;
      out.push({t: "code", lang: fence[1], v: lines.slice(i + 1, end).join("\n")});
      i = end + 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = Math.min(4, Math.max(2, heading[1].length)) as 2 | 3 | 4;
      const c = parseInline(heading[2]);
      const text = inlineText(c);
      const base = slugify(text) || "section";
      const n = ids.get(base) ?? 0;
      ids.set(base, n + 1);
      out.push({t: "heading", level, id: n === 0 ? base : `${base}-${n}`, c, text});
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) inner.push(lines[i++].replace(/^>\s?/, ""));
      out.push({t: "quote", c: parseBlocks(inner, ids)});
      continue;
    }

    if (line.trim().startsWith("|") && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) {
      const head = splitRow(line).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(splitRow(lines[i++]).map(parseInline));
      out.push({t: "table", head, rows});
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = !bullet;
      const re = ordered ? NUMBERED : BULLET;
      const items: string[] = [];
      const start = numbered ? Number(numbered[1]) : 1;
      while (i < lines.length) {
        const m = re.exec(lines[i]);
        if (m) {
          items.push(ordered ? m[2] : m[1]);
          i++;
          continue;
        }
        if (!lines[i].trim()) {
          // A blank line ends the list unless the next item of the same kind follows it.
          let k = i;
          while (k < lines.length && !lines[k].trim()) k++;
          if (k < lines.length && re.test(lines[k])) {
            i = k;
            continue;
          }
          break;
        }
        if (startsBlock(lines, i)) break;
        // A continuation line belongs to the item above it.
        items[items.length - 1] += ` ${lines[i].trim()}`;
        i++;
      }
      const parsed = items.map((s) => parseInline(s));
      out.push(ordered ? {t: "ol", start, items: parsed} : {t: "ul", items: parsed});
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !startsBlock(lines, i))) para.push(lines[i++].trim());
    out.push({t: "p", c: parseInline(para.join(" "))});
  }
  return out;
}

/** Split off the front matter and read its `description:`. */
function frontMatter(src: string): {description: string; body: string} {
  if (!src.startsWith("---\n")) return {description: "", body: src};
  const end = src.indexOf("\n---", 4);
  if (end < 0) return {description: "", body: src};
  const head = src.slice(4, end);
  const body = src.slice(end + 4).replace(/^\n/, "");
  const m = /^description:\s*(.*)$/m.exec(head);
  let description = m ? m[1].trim() : "";
  if (/^[>|]-?$/.test(description)) {
    // A folded block: the indented lines after it.
    const after = head.slice((m?.index ?? 0) + (m?.[0].length ?? 0)).split("\n");
    description = after.filter((l) => /^\s+\S/.test(l)).map((l) => l.trim()).join(" ");
  }
  description = description.replace(/^["']|["']$/g, "");
  return {description, body};
}

/** A whole page: its title is its first `#` heading, which is not repeated in the blocks. */
export function parsePage(src: string): ParsedPage {
  const {description, body} = frontMatter(src.replace(/\r\n/g, "\n"));
  const lines = body.split("\n");
  const h1 = lines.findIndex((l) => /^#\s+/.test(l));
  const title = h1 >= 0 ? inlineText(parseInline(lines[h1].replace(/^#\s+/, "").trim())) : "";
  if (h1 >= 0) lines.splice(h1, 1);
  return {title, description, blocks: parseBlocks(lines)};
}
