import {Brand} from "@/components/Brand";
import {NETWORK_NAME} from "@/components/app/network-copy";
import {DEMO_TEAM, PROGRAM_ID, explorer} from "@/lib/chain";
import {pda} from "@/lib/rein";
import {ArrowUpGlyph} from "./Drawings";
import {FooterLight} from "./FooterLight";
import styles from "./SiteFooter.module.css";

/**
 * The deployed contracts, linked to the explorer.
 *
 * Built from this build's network's `ADDRESSES` rather than typed here, so a
 * contract that is not deployed on a network is `null` and simply does not
 * appear. The alternative is a footer with three confident links, one of which 404s.
 */
const CONTRACTS = [
  {label: "Rein program", href: explorer("address", PROGRAM_ID.toBase58())},
  {label: "Service registry", href: explorer("address", pda.config().toBase58())},
  {label: "Demo team", href: DEMO_TEAM ? explorer("address", DEMO_TEAM) : null},
] as const;

/* Absolute, so the column works on every page in the group. A bare `#faq` from
   `/security` scrolls to nothing. */
const SECTIONS = [
  {href: "/#how-it-works", label: "How it works"},
  {href: "/#features", label: "Agents and people"},
  {href: "/#trust", label: "Our approach"},
  {href: "/#faq", label: "Questions"},
] as const;

/* The pages that are not the landing page. */
const PAGES = [
  {href: "/docs", label: "Read the docs"},
  {href: "/demo", label: "Try the live demo"},
  {href: "/security", label: "What stops a payment"},
  {href: "/build", label: "What we built"},
  {href: "/stats", label: "Rein in numbers"},
] as const;

/**
 * The site footer: it fades from the page into deep purple, sets the links in
 * the page's three columns, and ends in columns of light that rise out of the
 * foot of the page as you scroll to it.
 */
export function SiteFooter() {
  return (
    <footer className={styles.footer} data-site-footer="">
      <div className={styles.inner}>
        <div className={styles.rule} aria-hidden="true" />

        <div className={styles.grid}>
          <div className={styles.brand}>
            <p className={styles.wordmark}>
              <Brand />
            </p>
            <p className={styles.summary}>
              Spending rules for teams and their AI agents, enforced by a Solana program. Over a limit, the money waits for you.
            </p>
          </div>

          <nav className={styles.links} aria-label="Footer">
            <div>
              <h2 className={styles.label}>On this page</h2>
              <ul className={styles.list}>
                {SECTIONS.map((section) => (
                  <li key={section.href}>
                    <a className={styles.link} href={section.href}>
                      {section.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className={styles.label}>Read more</h2>
              <ul className={styles.list}>
                {PAGES.map((page) => (
                  <li key={page.href}>
                    <a className={styles.link} href={page.href}>
                      {page.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          <div className={styles.onchain}>
            <div>
              <h2 className={styles.label}>Onchain</h2>
              <ul className={styles.list}>
                {CONTRACTS.map((contract) => (
                  <li key={contract.label}>
                    {contract.href ? (
                      <a className={styles.link} href={contract.href} rel="noreferrer noopener" target="_blank">
                        {contract.label}
                        <span aria-hidden="true">↗</span>
                      </a>
                    ) : (
                      /* Not a link and not styled as one. "Not deployed" is a real state. */
                      <span className={styles.plain}>{contract.label} not deployed</span>
                    )}
                  </li>
                ))}
                <li>
                  <span className={styles.plain}>
                    {NETWORK_NAME}
                  </span>
                </li>
              </ul>
            </div>
            <a className={styles.top} href="#top">
              <span>Back to top</span>
              <span className={styles.topTile}>
                <ArrowUpGlyph />
              </span>
            </a>
          </div>
        </div>

        <div className={styles.legal}>
          <p>
            Live on {NETWORK_NAME} with test USDC. Not real money. Not independently audited.
            <br />
            MLH Solana Hackathon <span className="figure">2026</span>
          </p>
          <p className={styles.legalLinks}>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </p>
          <p>
            © <span className="figure">2026</span> Veltri Labs.
          </p>
        </div>
        <div className={styles.gutter} aria-hidden="true" />
      </div>

      <FooterLight />
    </footer>
  );
}
