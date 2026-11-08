import Image from "next/image";
import Link from "next/link";
import type {ReactNode} from "react";
import type {Block, HintStyle, Inline} from "@/lib/docs/markdown";
import styles from "./Docs.module.css";

/* The docs' parsed markdown, rendered as React. Server-only rendering: no client code ships. */

const HINT_LABEL: Record<HintStyle, string> = {info: "Note", warning: "Warning", success: "Good to know", danger: "Important"};

function Inlines({c}: {c: Inline[]}): ReactNode {
  return c.map((n, i) => {
    switch (n.t) {
      case "text":
        return n.v;
      case "code":
        return (
          <code key={i} className={styles.inlineCode}>
            {n.v}
          </code>
        );
      case "strong":
        return (
          <strong key={i}>
            <Inlines c={n.c} />
          </strong>
        );
      case "em":
        return (
          <em key={i}>
            <Inlines c={n.c} />
          </em>
        );
      case "link": {
        if (n.href.startsWith("/")) {
          return (
            <Link key={i} href={n.href}>
              <Inlines c={n.c} />
            </Link>
          );
        }
        const external = /^https?:/i.test(n.href);
        return (
          <a key={i} href={n.href} {...(external ? {target: "_blank", rel: "noopener noreferrer"} : {})}>
            <Inlines c={n.c} />
          </a>
        );
      }
    }
  });
}

export function DocsBlocks({blocks}: {blocks: Block[]}): ReactNode {
  return blocks.map((b, i) => {
    switch (b.t) {
      case "heading": {
        const H = (`h${b.level}` as "h2" | "h3" | "h4");
        return (
          <H key={i} id={b.id} className={styles[`h${b.level}`]}>
            <a className={styles.anchor} href={`#${b.id}`} aria-label={`Link to ${b.text}`}>
              #
            </a>
            <Inlines c={b.c} />
          </H>
        );
      }
      case "p":
        return (
          <p key={i}>
            <Inlines c={b.c} />
          </p>
        );
      case "ul":
        return (
          <ul key={i} className={styles.list}>
            {b.items.map((item, k) => (
              <li key={k}>
                <Inlines c={item} />
              </li>
            ))}
          </ul>
        );
      case "ol":
        return (
          <ol key={i} className={styles.list} start={b.start}>
            {b.items.map((item, k) => (
              <li key={k}>
                <Inlines c={item} />
              </li>
            ))}
          </ol>
        );
      case "table":
        return (
          <div key={i} className={styles.tableWrap} role="region" aria-label="Table" tabIndex={0}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {b.head.map((cell, k) => (
                    <th key={k} scope="col">
                      <Inlines c={cell} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, k) => (
                      <td key={k}>
                        <Inlines c={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "code":
        if (b.diagram) {
          return (
            <figure key={i} className={styles.diagram}>
              <a className={styles.diagramImage} href={b.diagram.src} target="_blank" rel="noopener noreferrer">
                <Image src={b.diagram.src} width={b.diagram.width} height={b.diagram.height} alt="Diagram. The same diagram is written out as text below it." unoptimized />
              </a>
              <figcaption className={styles.diagramCaption}>
                <a href={b.diagram.src} target="_blank" rel="noopener noreferrer">
                  Open the diagram full size
                </a>
              </figcaption>
              <details className={styles.details}>
                <summary>The diagram as text</summary>
                <div className={styles.detailsBody}>
                  <pre className={styles.diagramSource} tabIndex={0}>
                    <code>{b.v}</code>
                  </pre>
                </div>
              </details>
            </figure>
          );
        }
        return (
          <figure key={i} className={styles.codeBlock}>
            {b.lang ? <figcaption className={styles.codeLabel}>{b.lang === "mermaid" ? "Diagram source (Mermaid)" : b.lang}</figcaption> : null}
            <pre tabIndex={0}>
              <code>{b.v}</code>
            </pre>
          </figure>
        );
      case "quote":
        return (
          <blockquote key={i} className={styles.quote}>
            <DocsBlocks blocks={b.c} />
          </blockquote>
        );
      case "hint":
        return (
          <aside key={i} className={styles.hint} data-style={b.style}>
            <p className={styles.hintLabel}>
              <span className={styles.hintMark} aria-hidden="true" />
              {HINT_LABEL[b.style]}
            </p>
            <DocsBlocks blocks={b.c} />
          </aside>
        );
      case "tabs":
        return (
          <div key={i} className={styles.tabs}>
            {b.tabs.map((tab, k) => (
              <section key={k} className={styles.tab} aria-label={tab.title}>
                <p className={styles.tabLabel}>{tab.title}</p>
                <DocsBlocks blocks={tab.c} />
              </section>
            ))}
          </div>
        );
      case "stepper":
        return (
          <ol key={i} className={styles.stepper}>
            {b.steps.map((step, k) => (
              <li key={k} className={styles.step}>
                <span className={styles.stepNumber} aria-hidden="true">
                  {k + 1}
                </span>
                <div className={styles.stepBody}>
                  <DocsBlocks blocks={step} />
                </div>
              </li>
            ))}
          </ol>
        );
      case "details":
        return (
          <details key={i} className={styles.details}>
            <summary>
              <Inlines c={b.summary} />
            </summary>
            <div className={styles.detailsBody}>
              <DocsBlocks blocks={b.c} />
            </div>
          </details>
        );
    }
  });
}
