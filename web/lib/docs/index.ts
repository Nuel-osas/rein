import {createHash} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import path from "node:path";
import {type Block, type Diagram, type Inline, type ParsedPage, parseInline, inlineText, parsePage} from "./markdown";

/* ===========================================================================
   The docs at /docs, read from content/docs at build time.

   content/docs is written in GitBook's layout (SUMMARY.md is the table of
   contents, README.md the welcome page), so the same files can be imported
   into GitBook unchanged. Every page is rendered to static HTML at build, so
   nothing here runs on a request. It uses node:fs, so only server components
   import it (the docs routes and DocsView).

   Read through `process.cwd()` rather than `import.meta.url`: the build runs
   from web/, and a `new URL(..., import.meta.url)` is read by Turbopack as an
   asset import and breaks the dev server.
   =========================================================================== */

const DOCS_DIR = path.join(process.cwd(), "content", "docs");
const DIAGRAMS_DIR = path.join(process.cwd(), "public", "docs", "diagrams");

export interface DocLink {
  title: string;
  /** The page's file, relative to content/docs: "getting-started/quickstart.md". */
  file: string;
  /** Its URL: "/docs/getting-started/quickstart", and "/docs" for the welcome page. */
  href: string;
  /** The route segments, empty for the welcome page. */
  slug: string[];
}

export interface DocGroup {
  title: string | null;
  items: DocLink[];
}

export interface DocPage extends ParsedPage {
  file: string;
  href: string;
  group: string | null;
  /** The page's `##` headings, for "On this page". */
  toc: {id: string; text: string}[];
  prev: DocLink | null;
  next: DocLink | null;
}

/** "getting-started/quickstart.md" -> "/docs/getting-started/quickstart". */
export function hrefForFile(file: string): string {
  const stem = file.replace(/\.md$/, "");
  return stem === "README" ? "/docs" : `/docs/${stem}`;
}

/**
 * Where a link in a page goes. Relative `.md` links become /docs routes (keeping any `#anchor`);
 * anything else, a full URL or an in-page `#anchor`, is left as written.
 */
export function resolveHref(href: string, fromFile: string): string {
  if (/^[a-z]+:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return href;
  const [target, anchor] = href.split("#");
  if (!target.endsWith(".md")) return href;
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), target));
  return `${hrefForFile(joined)}${anchor ? `#${anchor}` : ""}`;
}

let navCache: DocGroup[] | null = null;

/** The table of contents, from SUMMARY.md. */
export function docsNav(): DocGroup[] {
  if (navCache) return navCache;
  const src = readFileSync(path.join(DOCS_DIR, "SUMMARY.md"), "utf8");
  const groups: DocGroup[] = [{title: null, items: []}];
  for (const line of src.split("\n")) {
    const group = /^##\s+(.*)$/.exec(line);
    if (group) {
      groups.push({title: group[1].trim(), items: []});
      continue;
    }
    const item = /^\s*\*\s+\[(.+?)\]\((.+?\.md)\)\s*$/.exec(line);
    if (!item) continue;
    const file = item[2];
    const stem = file.replace(/\.md$/, "");
    groups[groups.length - 1].items.push({
      title: inlineText(parseInline(item[1])),
      file,
      href: hrefForFile(file),
      slug: stem === "README" ? [] : stem.split("/"),
    });
  }
  navCache = groups.filter((g) => g.items.length > 0);
  return navCache;
}

/** Every page, in reading order. */
export function docsPages(): DocLink[] {
  return docsNav().flatMap((g) => g.items);
}

const pageCache = new Map<string, DocPage>();

/** One page by its route segments, or null when no page has that path. */
export function getDocPage(slug: string[]): DocPage | null {
  const key = slug.join("/");
  const hit = pageCache.get(key);
  if (hit) return hit;
  const pages = docsPages();
  const index = pages.findIndex((p) => p.slug.join("/") === key);
  if (index < 0) return null;
  const link = pages[index];
  const parsed = parsePage(readFileSync(path.join(DOCS_DIR, link.file), "utf8"));
  const page: DocPage = {
    ...parsed,
    title: parsed.title || link.title,
    blocks: prepare(parsed.blocks, link.file),
    file: link.file,
    href: link.href,
    group: docsNav().find((g) => g.items.includes(link))?.title ?? null,
    toc: parsed.blocks.flatMap((b) => (b.t === "heading" && b.level === 2 ? [{id: b.id, text: b.text}] : [])),
    prev: pages[index - 1] ?? null,
    next: pages[index + 1] ?? null,
  };
  pageCache.set(key, page);
  return page;
}

/** The file a Mermaid block is drawn to: a hash of its source, as the render script names it. */
export function diagramFile(source: string): string {
  return `${createHash("sha256").update(source.trim()).digest("hex").slice(0, 12)}.svg`;
}

/** The drawn SVG for a Mermaid block and its size, or null when it has not been drawn from this source. */
function diagramFor(source: string): Diagram | null {
  const file = diagramFile(source);
  const full = path.join(DIAGRAMS_DIR, file);
  if (!existsSync(full)) return null;
  const box = /viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/.exec(readFileSync(full, "utf8"));
  if (!box) return null;
  return {src: `/docs/diagrams/${file}`, width: Math.round(Number(box[1])), height: Math.round(Number(box[2]))};
}

/** Every link in the tree resolved against the page it sits on, and every Mermaid block given its drawing. */
function prepare(blocks: Block[], file: string): Block[] {
  const inl = (c: Inline[]): Inline[] =>
    c.map((n) => (n.t === "link" ? {...n, href: resolveHref(n.href, file), c: inl(n.c)} : n.t === "strong" || n.t === "em" ? {...n, c: inl(n.c)} : n));
  return blocks.map((b): Block => {
    switch (b.t) {
      case "heading":
      case "p":
        return {...b, c: inl(b.c)};
      case "ul":
      case "ol":
        return {...b, items: b.items.map(inl)};
      case "table":
        return {...b, head: b.head.map(inl), rows: b.rows.map((r) => r.map(inl))};
      case "quote":
      case "hint":
        return {...b, c: prepare(b.c, file)};
      case "tabs":
        return {...b, tabs: b.tabs.map((t) => ({...t, c: prepare(t.c, file)}))};
      case "stepper":
        return {...b, steps: b.steps.map((s) => prepare(s, file))};
      case "details":
        return {...b, summary: inl(b.summary), c: prepare(b.c, file)};
      case "code": {
        const diagram = b.lang === "mermaid" ? diagramFor(b.v) : null;
        return diagram ? {...b, diagram} : b;
      }
    }
  });
}
