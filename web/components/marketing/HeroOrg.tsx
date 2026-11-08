import {type CSSProperties, useId} from "react";
import styles from "./HeroOrg.module.css";

/* ===========================================================================
   The hero's diagram: one example team as an org chart, in the page's traced
   style, with a payment story that plays on a 12 second loop.

   Team account at the top, its owner under it, the spenders (a person and two
   AI agents, each with its policy on one line) under the owner, and each
   spender's approved service under it. Connectors are right-angled traces
   with small squares at their junctions.

   The loop (HeroOrg.module.css holds the timeline):
   a. an agent pays within its policy: a pulse runs from the research agent down to the
      model provider (`ILLUSTRATED_SERVICES` in `lib/catalogue.ts`: Acme
      Inference API on testnet; on mainnet, which has no merchant to pay yet,
      a plain "AI model provider" with no brand), the service flashes, "Paid
      $5.00" ticks up under it and the team balance drops by five dollars;
   b. a person's payment is over his cap: Ada's pulse stops at the gate on
      his trace, the trace turns a muted amber, the request runs up to the
      owner ("Approve?", then "Approved"), comes back down, and goes on to the
      service, which is paid;
   c. a beat at rest while the dashes march and the nodes breathe; the tags
      fade and the balance is reset for the next loop.

   Two layouts from one set of nodes: the wide org chart, and on a phone a
   vertical chain (team account, owner, the research agent, the gate, the model provider) where the research agent's
   $40 request over his $5 cap plays the exception. Positions are in each
   layout's own units; nodes are centred on their points and opaque, so a
   trace drawn between two centres reads as running edge to edge.

   Decoration: the whole diagram is `aria-hidden`. LandingPage says what it
   shows in one visually hidden sentence. With reduced motion it is the
   complete chart, still.
   =========================================================================== */

type Pt = readonly [x: number, y: number];
type NodeId = "account" | "owner" | "marcus" | "ronnie" | "scout" | "northwind" | "acme" | "relay";

const NODES: Record<NodeId, {kind: string; title: string; meta?: string}> = {
  account: {kind: "Team vault", title: "Acme Research"},
  owner: {kind: "Owner", title: "You", meta: "Approves exceptions"},
  marcus: {kind: "Person", title: "Ada", meta: "$100 / week"},
  ronnie: {kind: "Agent", title: "Research agent", meta: "$20 / day · $5 cap"},
  scout: {kind: "Agent", title: "Scout", meta: "$30 / week"},
  northwind: {kind: "Service", title: "market-data"},
  acme: {kind: "Service", title: "gpu-hour"},
  relay: {kind: "Service", title: "web-search"},
};

type Layout = {
  name: "wide" | "chain";
  w: number;
  h: number;
  /** Each node's centre and width. `role` names its part in the loop (see the stylesheet). */
  nodes: ReadonlyArray<{id: NodeId; at: Pt; w: number; role?: string; rank: number}>;
  /** The org chart's traces, drawn in this order on load. */
  traces: readonly string[];
  /** The route an exception takes to the owner. */
  escalation: string;
  junctions: readonly Pt[];
  gate: Pt;
  /** Traces lit while a payment passes: the agent's run, the stopped run above the gate, and below it. */
  lit: {pay: string; held: string; release: string};
  /** Waypoints: the payment, the held payment, up to the owner, back to the gate, on to the service. */
  pulses: {pay: readonly Pt[]; held: readonly Pt[]; ask: readonly Pt[]; answer: readonly Pt[]; release: readonly Pt[]};
  /** Where each tag sits: its point, and whether it hangs from it (centred below) or sits beside it. */
  tags: {paid: Pt; paid2: Pt; owner: Pt; ownerInside: boolean; gate: Pt};
  copy: {cap: string; paid2: string; balance2: string};
};

const BALANCE0 = "$500.00", BALANCE1 = "$495.00";

/** A route through waypoints as the ask pulse's keyframes expect it: five points, the last four
 *  at the same fractions of the route as the wide chart's. A straight route is split to match. */
const along = (from: Pt, to: Pt, fractions: readonly number[]): Pt[] => [
  from,
  ...fractions.map((f): Pt => [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f]),
];

/* The wide chart, in a 760 x 600 box. Columns at 140, 380 and 620. */
const COL = [140, 380, 620] as const;
const ROW = {account: 42, owner: 150, bus: 214, spender: 298, gate: 392, service: 484} as const;
const EDGE = 12; // the exception route's outer leg
// The routes' corners fall at these fractions of their length (128 + 242 + 368 = 738); the
// keyframes `orgAsk` and `orgAnswer` stop at the same fractions, so a pulse keeps one pace.
const ASK = [128 / 738, 370 / 738, 618 / 738, 1] as const;
const ANSWER = [368 / 738, 610 / 738, 737 / 738, 1] as const;

const WIDE: Layout = {
  name: "wide",
  w: 760,
  h: 600,
  nodes: [
    {id: "account", at: [380, ROW.account], w: 300, role: "account", rank: 0},
    {id: "owner", at: [380, ROW.owner], w: 240, role: "owner", rank: 1},
    {id: "marcus", at: [COL[0], ROW.spender], w: 210, role: "asker", rank: 2},
    {id: "ronnie", at: [COL[1], ROW.spender], w: 210, role: "payer", rank: 3},
    {id: "scout", at: [COL[2], ROW.spender], w: 210, rank: 4},
    {id: "northwind", at: [COL[0], ROW.service], w: 210, role: "paid2", rank: 5},
    {id: "acme", at: [COL[1], ROW.service], w: 210, role: "paid", rank: 6},
    {id: "relay", at: [COL[2], ROW.service], w: 210, rank: 7},
  ],
  traces: [
    `M380 ${ROW.account}V${ROW.spender}`,
    `M${COL[0]} ${ROW.spender}V${ROW.bus}H${COL[2]}V${ROW.spender}`,
    `M${COL[1]} ${ROW.spender}V${ROW.service}`,
    `M${COL[0]} ${ROW.spender}V${ROW.service}`,
    `M${COL[2]} ${ROW.spender}V${ROW.service}`,
  ],
  escalation: `M${COL[0]} ${ROW.gate}H${EDGE}V${ROW.owner}H380`,
  junctions: [[COL[0], ROW.bus], [380, ROW.bus], [COL[2], ROW.bus], [EDGE, ROW.gate], [EDGE, ROW.owner]],
  gate: [COL[0], ROW.gate],
  lit: {
    pay: `M${COL[1]} ${ROW.spender}V${ROW.service}`,
    held: `M${COL[0]} ${ROW.spender}V${ROW.gate}`,
    release: `M${COL[0]} ${ROW.gate}V${ROW.service}`,
  },
  pulses: {
    pay: [[COL[1], ROW.spender], [COL[1], ROW.service]],
    held: [[COL[0], ROW.spender], [COL[0], ROW.gate]],
    ask: [[COL[0], ROW.gate], [EDGE, ROW.gate], [EDGE, ROW.owner], [260, ROW.owner], [380, ROW.owner]],
    answer: [[380, ROW.owner], [EDGE, ROW.owner], [EDGE, ROW.gate], [COL[0] - 1, ROW.gate], [COL[0], ROW.gate]],
    release: [[COL[0], ROW.gate], [COL[0], ROW.service]],
  },
  tags: {paid: [COL[1], ROW.service + 46], paid2: [COL[0], ROW.service + 46], owner: [380 + 132, ROW.owner], ownerInside: false, gate: [COL[0] + 14, ROW.gate]},
  copy: {cap: "Over the $25 cap", paid2: "$40.00", balance2: "$455.00"},
};

/* The phone's chain, in a 340 x 430 box, down one trace at x = 170. */
const X = 170;
const CH = {account: 32, owner: 120, ronnie: 208, gate: 284, acme: 360} as const;

const CHAIN: Layout = {
  name: "chain",
  w: 340,
  h: 430,
  nodes: [
    {id: "account", at: [X, CH.account], w: 340, role: "account", rank: 0},
    {id: "owner", at: [X, CH.owner], w: 340, role: "owner", rank: 1},
    {id: "ronnie", at: [X, CH.ronnie], w: 340, role: "payer asker", rank: 2},
    {id: "acme", at: [X, CH.acme], w: 340, role: "paid paid2", rank: 3},
  ],
  traces: [`M${X} ${CH.account}V${CH.acme}`],
  escalation: `M${X} ${CH.gate}V${CH.owner}`,
  junctions: [],
  gate: [X, CH.gate],
  lit: {pay: `M${X} ${CH.ronnie}V${CH.acme}`, held: `M${X} ${CH.ronnie}V${CH.gate}`, release: `M${X} ${CH.gate}V${CH.acme}`},
  pulses: {
    pay: [[X, CH.ronnie], [X, CH.acme]],
    held: [[X, CH.ronnie], [X, CH.gate]],
    ask: along([X, CH.gate], [X, CH.owner], ASK),
    answer: along([X, CH.owner], [X, CH.gate], ANSWER),
    release: [[X, CH.gate], [X, CH.acme]],
  },
  tags: {paid: [X, CH.acme + 46], paid2: [X, CH.acme + 46], owner: [X + 158, CH.owner], ownerInside: true, gate: [X + 14, CH.gate]},
  copy: {cap: "Over the $5 cap", paid2: "$9.00", balance2: "$486.00"},
};

const pct = (layout: Layout, [x, y]: Pt) => ({left: `${((x / layout.w) * 100).toFixed(3)}%`, top: `${((y / layout.h) * 100).toFixed(3)}%`});

/** A pulse's waypoints as custom properties, in percentages of the box (its layer is the box's size). */
const route = (layout: Layout, points: readonly Pt[]) =>
  Object.fromEntries(
    points.flatMap(([x, y], i) => [
      [`--x${i}`, `${((x / layout.w) * 100).toFixed(3)}%`],
      [`--y${i}`, `${((y / layout.h) * 100).toFixed(3)}%`],
    ]),
  ) as CSSProperties;

function Diagram({layout}: {layout: Layout}) {
  const maskId = `org${layout.name}${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const {w, h} = layout;
  return (
    // The wide chart keeps its proportions; the chain is all vertical lines, so it takes the full
    // width at a fixed height (HeroOrg.module.css) and nothing it draws is stretched.
    <div className={styles.box} data-layout={layout.name} style={layout.name === "wide" ? {aspectRatio: `${w} / ${h}`} : undefined}>
      <svg className={styles.lines} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          {/* The traces are drawn on through this mask: a dashed line cannot be drawn on by its own dash offset. */}
          <mask id={maskId} maskUnits="userSpaceOnUse" x="-10" y="-10" width={w + 20} height={h + 20}>
            {[...layout.traces, layout.escalation].map((d, i) => (
              <path key={i} className={styles.reveal} d={d} pathLength={1} stroke="#fff" strokeWidth="10" fill="none" style={{"--i": i} as CSSProperties} />
            ))}
          </mask>
        </defs>
        <g mask={`url(#${maskId})`} fill="none">
          {layout.traces.map((d, i) => (
            <path key={i} className={styles.trace} d={d} />
          ))}
          {/* On the chain the route runs back up the trunk, so it is only drawn while it is lit. */}
          {layout.name === "wide" ? <path className={styles.route} d={layout.escalation} /> : null}
        </g>
        <g fill="none">
          <path className={styles.lit} data-lit="pay" d={layout.lit.pay} />
          <path className={styles.warm} data-warm="held" d={layout.lit.held} />
          <path className={styles.warm} data-warm="route" d={layout.escalation} />
          <path className={styles.lit} data-lit="release" d={layout.lit.release} />
        </g>
      </svg>

      {layout.junctions.map((p) => (
        <span key={`${p[0]}-${p[1]}`} className={styles.junction} style={pct(layout, p)} />
      ))}
      <span className={styles.gate} style={pct(layout, layout.gate)}>
        <i />
      </span>

      {/* Payments: each a layer the box's size, moved by percentages; a small square at its corner. */}
      <span className={styles.pulse} data-pulse="pay" style={route(layout, layout.pulses.pay)}>
        <i />
      </span>
      <span className={styles.pulse} data-pulse="held" style={route(layout, layout.pulses.held)}>
        <i />
      </span>
      <span className={styles.pulse} data-pulse="ask" style={route(layout, layout.pulses.ask)}>
        <i />
      </span>
      <span className={styles.pulse} data-pulse="answer" style={route(layout, layout.pulses.answer)}>
        <i />
      </span>
      <span className={styles.pulse} data-pulse="release" style={route(layout, layout.pulses.release)}>
        <i />
      </span>

      {layout.nodes.map(({id, at, w: nodeW, role, rank}) => {
        const node = NODES[id];
        return (
          <div
            key={id}
            className={styles.node}
            data-kind={node.kind.toLowerCase().replace(" ", "-")}
            data-role={role}
            style={{...pct(layout, at), inlineSize: `${((nodeW / layout.w) * 100).toFixed(3)}%`, "--rank": rank} as CSSProperties}
          >
            <span className={styles.kind}>[ {node.kind} ]</span>
            <span className={styles.title}>
              <strong>{node.title}</strong>
              {id === "account" ? (
                <span className={styles.balance}>
                  <span data-balance="0">{BALANCE0}</span>
                  <span data-balance="1">{BALANCE1}</span>
                  <span data-balance="2">{layout.copy.balance2}</span>
                </span>
              ) : null}
            </span>
            {node.meta ? <span className={styles.meta}>{node.meta}</span> : null}
            {id === "owner" && layout.tags.ownerInside ? (
              <span className={styles.ownerTags} data-inside="">
                <span className={styles.tag} data-tag="ask">
                  Approve?
                </span>
                <span className={styles.tag} data-tag="approved">
                  Approved
                </span>
              </span>
            ) : null}
          </div>
        );
      })}

      {layout.tags.ownerInside ? null : (
        <span className={styles.ownerTags} style={pct(layout, layout.tags.owner)}>
          <span className={styles.tag} data-tag="ask">
            Approve?
          </span>
          <span className={styles.tag} data-tag="approved">
            Approved
          </span>
        </span>
      )}
      <span className={styles.tag} data-tag="cap" style={pct(layout, layout.tags.gate)}>
        {layout.copy.cap}
      </span>
      <span className={styles.tag} data-tag="paid" style={pct(layout, layout.tags.paid)}>
        Paid <b>$5.00</b>
      </span>
      <span className={styles.tag} data-tag="paid2" style={pct(layout, layout.tags.paid2)}>
        Paid <b>{layout.copy.paid2}</b>
      </span>
    </div>
  );
}

/**
 * The hero's org chart. `data-loop` lets LandingPage's `useDrawings` pause its
 * loop while it is off screen.
 */
export function HeroOrg({className}: {className?: string}) {
  return (
    <div className={[styles.org, className].filter(Boolean).join(" ")} aria-hidden="true" data-loop="">
      <span className={styles.note}>Example team on Solana devnet</span>
      <div className={styles.wide}>
        <Diagram layout={WIDE} />
      </div>
      <div className={styles.chain}>
        <Diagram layout={CHAIN} />
      </div>
    </div>
  );
}

/** What the diagram shows, for assistive technology. */
export const HERO_ORG_SUMMARY =
  "Example: a team vault owned by you. Ada, a person, and two AI agents each pay registered services within their own limits; a payment over a limit is held on chain until you approve it.";
