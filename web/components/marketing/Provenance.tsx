import type {ReactNode} from "react";
import {PROGRAM_ID, explorer} from "@/lib/chain";
import {pda} from "@/lib/rein";
import {IconNotice} from "./Icons";
import styles from "./Provenance.module.css";

/* ===========================================================================
   The parts the provenance page (/build) is assembled from.

   One idea runs through all of them: a claim and the thing that backs it are
   never separated. Every row below takes an `evidence` list and there is no
   variant that omits it, so a sentence nobody can check cannot be typed into
   this page without also deleting a required prop.

   Evidence is plain text when it is a path in the repository (a reader can
   grep it) and a link when it is something on chain, because a transaction or
   an account resolves for anybody with a browser.
   =========================================================================== */

/**
 * The addresses this page shows. Derived where the code derives them (the program id comes from
 * the IDL, the registry is the `["config"]` PDA), and otherwise copied from `docs/CONSTANTS.md`,
 * which records how each one was verified. When the two disagree, CONSTANTS.md wins and this is
 * the bug.
 */
export const PROGRAM_ADDRESS = PROGRAM_ID.toBase58();
/** `["config"]`: `9wir7aGb…`, written by `init_config` during `pnpm seed` (CONSTANTS.md). */
export const REGISTRY_ADDRESS = pda.config().toBase58();
/** Team "Acme Research", `["team", owner]` (CONSTANTS.md, "Demo team"). */
export const DEMO_TEAM_ADDRESS = "EWuQEKAj3hmQJxBvPJ7PWYM38xcCqhivYao9afEy6Bg5";
/** Test USDC: `spl-token display` shows 6 decimals and Rein's mint authority (CONSTANTS.md). */
export const MINT_ADDRESS = "Cwc241qD8qJiXDTgGZ2y6nLQg59cdkXzhCHz3vgFoa14";
/** The fee payer for every sponsored transaction (CONSTANTS.md, "Sponsor"). */
export const SPONSOR_ADDRESS = "hEczh4E1DGuGPTikSLGZKZUAxSAF7Cw1vaSNrxatfjF";

/** A path, a count, or a link to something on chain. Never a feeling. */
type EvidenceItem = string | {label: string; href: string};
type Evidence = readonly EvidenceItem[];

/** An explorer link for a transaction signature, on this build's cluster. */
export function txEvidence(label: string, signature: string): EvidenceItem {
  return {label, href: explorer("tx", signature)};
}

/**
 * Breaks a path after each separator, and nowhere else.
 *
 * A path has no spaces in it, so a narrow column breaks it wherever the line
 * runs out, which reads as a different file. `<wbr>` is a break opportunity
 * that inserts no character, so copying the path still yields the original.
 */
function breakablePath(value: string) {
  if (!value.includes("/")) return value;

  const segments = value.split("/");
  return segments.map((segment, i) => (
    <span key={`${segment}-${i}`}>
      {segment}
      {i < segments.length - 1 ? (
        <>
          /<wbr />
        </>
      ) : null}
    </span>
  ));
}

function EvidenceList({items}: {items: Evidence}) {
  return (
    <ul className={styles.evidence}>
      {items.map((item) =>
        typeof item === "string" ? (
          <li className={styles.tag} key={item}>
            {breakablePath(item)}
          </li>
        ) : (
          <li className={styles.tag} key={item.href}>
            <a className={styles.tagLink} href={item.href} rel="noreferrer noopener" target="_blank">
              {item.label} <span aria-hidden="true">↗</span>
            </a>
          </li>
        ),
      )}
    </ul>
  );
}

export function Ledger({children}: {children: ReactNode}) {
  return <ul className={styles.ledger}>{children}</ul>;
}

/**
 * One claim: the name, the reasoning, and the receipt, on one row. The receipt is a third column
 * once there is room, so a row is as tall as its content and the prose keeps a real measure.
 */
export function LedgerRow({
  name,
  evidence,
  children,
}: {
  name: string;
  evidence: Evidence;
  children: ReactNode;
}) {
  return (
    <li className={styles.row}>
      <h3 className={styles.name}>{name}</h3>
      <p className={styles.body}>{children}</p>
      <EvidenceList items={evidence} />
    </li>
  );
}

/** The note under the masthead. Its own class, so no browser margin leaks into the intro. */
export function IntroNote({children}: {children: ReactNode}) {
  return <p className={styles.introNote}>{children}</p>;
}

/** The line under a ledger that adds it up. */
export function Totals({children}: {children: ReactNode}) {
  return <p className={styles.totals}>{children}</p>;
}

export function Facts({children}: {children: ReactNode}) {
  return <div className={styles.facts}>{children}</div>;
}

/**
 * An account on chain, with the address and a way to check it. `address` is nullable on purpose:
 * missing renders as words rather than as a card that looks deployed with an empty value in it.
 */
export function Fact({
  label,
  address,
  children,
}: {
  label: string;
  address: string | null;
  children: ReactNode;
}) {
  return (
    <article className={styles.fact}>
      <h3 className={styles.factLabel}>{label}</h3>
      {address ? (
        <>
          <span className={styles.address}>{address}</span>
          <a className={styles.explorer} href={explorer("address", address)} rel="noreferrer noopener" target="_blank">
            View on Solana Explorer <span aria-hidden="true">↗</span>
          </a>
        </>
      ) : (
        <span className={styles.address}>Not deployed</span>
      )}
      <p className={styles.factNote}>{children}</p>
    </article>
  );
}

export function OpenList({children}: {children: ReactNode}) {
  return <ul className={styles.open}>{children}</ul>;
}

/**
 * Something that is not finished. The glyph is carried rather than a colour, because "not done"
 * has to survive being read by somebody who cannot separate amber from grey.
 */
export function OpenItem({
  title,
  evidence,
  children,
}: {
  title: string;
  evidence: Evidence;
  children: ReactNode;
}) {
  return (
    <li className={styles.openItem}>
      <span className={styles.openIcon}>
        <IconNotice size="card" />
      </span>
      <h3 className={styles.name}>{title}</h3>
      <div className={styles.openBody}>
        <p className={styles.body}>{children}</p>
        <EvidenceList items={evidence} />
      </div>
    </li>
  );
}

/** The closing note: how a reader reproduces everything above. */
export function HowToCheck({children}: {children: ReactNode}) {
  return <div className={styles.howto}>{children}</div>;
}
