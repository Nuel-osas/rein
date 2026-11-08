import {type CSSProperties, useId} from "react";
import {MARK_HEIGHT, MARK_PATH, MARK_WIDTH} from "@/components/brand-mark";
import styles from "./Drawings.module.css";

/* ===========================================================================
   Dotted line drawings for the landing page, and its three small glyphs.

   Each drawing is a few named parts of 3D polylines projected to isometric
   once, at module load, so every drawing shares one projection and one line
   style rather than being hand-placed in 2D. The edges a solid object would
   hide are kept apart and drawn fainter and finer, so a box reads as a box
   rather than a star of twelve equal lines.

   They are decoration: `aria-hidden`, no text inside, and the page says the
   same thing without them. The colour is `currentColor`, so a drawing is
   quiet ink on the light sections and a faint white on the dark ones.

   MOTION (Drawings.module.css). The server HTML is the finished drawing, still.
   After hydration, LandingPage's `useDrawings` sets `data-draw` on each one:
   - `waiting`: below the fold; the strokes are masked out;
   - `in`: scrolled into view; the dashed strokes are revealed line by line
     through a mask (a dashed line cannot be drawn on with its own dash
     offset), then the idle loop starts;
   - `live`: already on screen at hydration; no draw-in, only the idle loop.
   `data-visible="false"` pauses every loop while it is off screen. With
   reduced motion the hook never runs and none of the CSS applies.
   =========================================================================== */

type Vec = readonly [x: number, y: number, z: number];
type Flat = readonly [x: number, y: number];
type Poly = {points: readonly Vec[]; closed?: boolean};
type FlatPoly = {points: readonly Flat[]; closed?: boolean};

/**
 * One part of a drawing. `lines` are the edges in view, `hidden` the ones a
 * solid would hide. A `plane` part is a flat figure (a dial) drawn in its own
 * 2D coordinates under one matrix, so CSS can turn it in its plane.
 */
type Part = {
  key: string;
  index?: number;
  lines?: readonly Poly[];
  hidden?: readonly Poly[];
  plane?: {origin: Vec; u: Vec; v: Vec; lines: readonly FlatPoly[]};
  /** Redrawn on a loop through its own mask (the shield's tick, the receipt's lines). */
  loop?: boolean;
  /** Carries a solid copy of itself that can flash (the registry's services). */
  flash?: boolean;
};

/** A small square that travels along `path` in the idle loop. */
type Mover = {key: string; index?: number; path: readonly Vec[]};
type Shape = {parts: readonly Part[]; marks?: readonly Vec[]; movers?: readonly Mover[]};

const COS30 = Math.cos(Math.PI / 6);
const project = ([x, y, z]: Vec): [number, number] => [(x - y) * COS30, (x + y) * 0.5 - z];

/**
 * A box from its low corner. The view is from (+1, +1, +1), so the three edges
 * meeting at the low corner are the hidden ones.
 */
const box = (x: number, y: number, z: number, w: number, d: number, h: number): {lines: Poly[]; hidden: Poly[]} => {
  const at = (dx: number, dy: number, dz: number): Vec => [x + dx, y + dy, z + dz];
  return {
    lines: [
      {points: [at(0, 0, h), at(w, 0, h), at(w, d, h), at(0, d, h)], closed: true},
      {points: [at(w, 0, 0), at(w, d, 0), at(0, d, 0)]},
      {points: [at(w, 0, 0), at(w, 0, h)]},
      {points: [at(w, d, 0), at(w, d, h)]},
      {points: [at(0, d, 0), at(0, d, h)]},
    ],
    hidden: [
      {points: [at(w, 0, 0), at(0, 0, 0), at(0, d, 0)]},
      {points: [at(0, 0, 0), at(0, 0, h)]},
    ],
  };
};

/** A circle in one of the three axis planes, as a closed polyline. */
const circle = (centre: Vec, r: number, plane: "xy" | "xz", steps = 36): Poly => {
  const points: Vec[] = [];
  const [cx, cy, cz] = centre;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const a = r * Math.cos(t), b = r * Math.sin(t);
    points.push(plane === "xy" ? [cx + a, cy + b, cz] : [cx + a, cy, cz + b]);
  }
  return {points, closed: true};
};

const rect = (plane: "xy" | "xz", x0: number, x1: number, b0: number, b1: number, at: number): Poly =>
  plane === "xy"
    ? {points: [[x0, b0, at], [x1, b0, at], [x1, b1, at], [x0, b1, at]], closed: true}
    : {points: [[x0, at, b0], [x1, at, b0], [x1, at, b1], [x0, at, b1]], closed: true};

/** A ring in a plane's own coordinates. */
const ring = (r: number, steps = 36): FlatPoly => ({
  points: Array.from({length: steps}, (_, i): Flat => {
    const t = (i / steps) * Math.PI * 2;
    return [r * Math.cos(t), r * Math.sin(t)];
  }),
  closed: true,
});

/** `count` spokes from radius r0 to r1, the first pointing up the plane. */
const spokes = (count: number, r0: number, r1: number): FlatPoly[] =>
  Array.from({length: count}, (_, i) => {
    const t = Math.PI / 2 + (i / count) * Math.PI * 2;
    return {points: [[r0 * Math.cos(t), r0 * Math.sin(t)], [r1 * Math.cos(t), r1 * Math.sin(t)]]};
  });

/** A box with no lid, for a body whose top is covered by the part above it. */
const walls = (x: number, y: number, z: number, w: number, d: number, h: number) => {
  const b = box(x, y, z, w, d, h);
  return {lines: b.lines.slice(1), hidden: b.hidden};
};

/** An arc of `steps` from θ0 to θ1 of a flat circle in the xy plane. */
const arcXY = ([cx, cy, cz]: Vec, r: number, t0: number, t1: number, steps = 18): Vec[] =>
  Array.from({length: steps + 1}, (_, i): Vec => {
    const t = t0 + ((t1 - t0) * i) / steps;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t), cz];
  });

/**
 * A coin lying flat: its face, the front half of its lower rim, and the two sides where its
 * outline turns. The half of the rim a solid coin would hide is kept apart. From (+1, +1, +1)
 * the outline turns at -45° and 135°, and the front half is the one between them.
 */
const coin = (cx: number, cy: number, z: number, r: number, t: number): {lines: Poly[]; hidden: Poly[]} => {
  const a = -Math.PI / 4, b = (3 * Math.PI) / 4;
  const side = (angle: number): Poly => ({points: [[cx + r * Math.cos(angle), cy + r * Math.sin(angle), z], [cx + r * Math.cos(angle), cy + r * Math.sin(angle), z + t]]});
  return {
    lines: [circle([cx, cy, z + t], r, "xy"), {points: arcXY([cx, cy, z], r, a, b)}, side(a), side(b)],
    hidden: [{points: arcXY([cx, cy, z], r, b, a + Math.PI * 2)}],
  };
};

const sub = (p: Vec, q: Vec): Vec => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const cross = (p: Vec, q: Vec): Vec => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const unit = (p: Vec): Vec => {
  const l = Math.hypot(...p) || 1;
  return [p[0] / l, p[1] / l, p[2] / l];
};

/**
 * A path that rises from `from` to `to` in their vertical plane, `lift` above the straight line
 * at its middle, with an arrowhead at its end, drawn in the same plane.
 */
const hop = (from: Vec, to: Vec, lift: number, size = 7, steps = 20): Poly[] => {
  const points = Array.from({length: steps + 1}, (_, i): Vec => {
    const s = i / steps;
    return [from[0] + (to[0] - from[0]) * s, from[1] + (to[1] - from[1]) * s, from[2] + (to[2] - from[2]) * s + lift * Math.sin(Math.PI * s)];
  });
  const end = points[steps]!;
  const dir = unit(sub(end, points[steps - 1]!));
  const across = unit(cross(cross(dir, [0, 0, 1]), dir));
  const wing = (k: number): Vec => [end[0] - dir[0] * size + across[0] * size * k, end[1] - dir[1] * size + across[1] * size * k, end[2] - dir[2] * size + across[2] * size * k];
  return [{points}, {points: [wing(0.6), end, wing(-0.6)]}];
};

const SHAPES = {
  /** The shared account: a vault, its door and hinges, and the wheel that turns. */
  vault: (() => {
    const body = box(0, 0, 0, 110, 80, 76);
    return {
      parts: [
        {
          key: "body",
          lines: [
            ...body.lines,
            rect("xz", 12, 98, 10, 66, 80),
            rect("xz", 17, 93, 15, 61, 80),
            rect("xz", 5, 12, 16, 24, 80),
            rect("xz", 5, 12, 52, 60, 80),
            {points: [[34, 18, 76], [76, 18, 76]]},
          ],
          hidden: body.hidden,
        },
        {key: "dial", plane: {origin: [55, 80, 38], u: [1, 0, 0], v: [0, 0, 1], lines: [ring(17), ring(6, 18), ...spokes(3, 6, 17)]}},
      ],
    };
  })(),
  /** Approval: a shield with a tick, given a little depth. */
  shield: (() => {
    const outline = (y: number): Vec[] => {
      // Straight sides, then each sweeps in to the point: x moves slowly at first, z steadily.
      const pts: Vec[] = [[0, y, 100], [84, y, 100], [84, y, 60]];
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        pts.push([84 - 42 * t * t, y, 60 - 60 * t]);
      }
      for (let i = 7; i >= 1; i--) {
        const t = i / 8;
        pts.push([42 * t * t, y, 60 - 60 * t]);
      }
      pts.push([0, y, 60]);
      return pts;
    };
    const front = outline(16), back = outline(0);
    return {
      parts: [
        {
          key: "body",
          // The back outline shows only where it is the silhouette: the top, the right side and
          // the upper part of the right sweep. The rest is behind the front.
          lines: [
            {points: front, closed: true},
            {points: back.slice(0, 9)},
            {points: [back[0]!, front[0]!]},
            {points: [back[1]!, front[1]!]},
            {points: [back[2]!, front[2]!]},
          ],
          hidden: [{points: [...back.slice(8), back[0]!]}, {points: [back[10]!, front[10]!]}],
        },
        {key: "check", loop: true, lines: [{points: [[24, 16, 58], [38, 16, 42], [62, 16, 76]]}]},
      ],
    };
  })(),
  /** A receipt lying flat, its torn edge, its lines and its stamp. */
  receipt: (() => {
    const stamp = box(46, 86, 0, 14, 14, 14);
    return {
      parts: [
        {
          key: "body",
          lines: [
            {
              points: [
                [0, 0, 0], [72, 0, 0], [72, 116, 0],
                ...Array.from({length: 8}, (_, i): Vec => [72 - (i + 1) * 9, i % 2 === 0 ? 108 : 116, 0]),
              ],
              closed: true,
            },
            ...stamp.lines,
          ],
          hidden: stamp.hidden,
        },
        {
          key: "text",
          loop: true,
          lines: [
            {points: [[12, 18, 0], [60, 18, 0]]},
            {points: [[12, 32, 0], [48, 32, 0]]},
            {points: [[12, 46, 0], [56, 46, 0]]},
            {points: [[12, 74, 0], [36, 74, 0]]},
            {points: [[48, 74, 0], [60, 74, 0]]},
          ],
        },
      ],
    };
  })(),
  /** The registry: services as nodes, joined to the account in the middle. */
  nodes: (() => {
    const core = box(46, 46, 0, 28, 28, 28);
    // Clockwise on screen from the top: back, right, front, left.
    const services: ReadonlyArray<{at: Flat; from: Vec; to: Vec}> = [
      {at: [0, 0], from: [16, 16, 8], to: [46, 46, 14]},
      {at: [104, 0], from: [104, 16, 8], to: [74, 46, 14]},
      {at: [104, 104], from: [104, 104, 8], to: [74, 74, 14]},
      {at: [0, 104], from: [16, 104, 8], to: [46, 74, 14]},
    ];
    return {
      parts: [
        {key: "core", lines: core.lines, hidden: core.hidden},
        {key: "ring", lines: [circle([60, 60, 0], 58, "xy", 48)]},
        ...services.map(({at: [x, y]}, i): Part => ({key: "service", index: i, flash: true, ...box(x, y, 0, 16, 16, 16)})),
        {
          key: "spokes",
          // The back spoke runs behind the centre box.
          lines: services.slice(1).map(({from, to}) => ({points: [from, to]})),
          hidden: [{points: [services[0]!.from, services[0]!.to]}],
        },
      ],
      movers: services.map(({from, to}, i) => ({key: "spoke", index: i, path: [from, to]})),
    };
  })(),
  /** Settlement: four blocks in a chain, each joined to the next. */
  chain: (() => {
    const blocks = [0, 1, 2, 3].map((i) => box(i * 60, 0, i * 24, 40, 40, 40));
    return {
      parts: [
        {
          key: "body",
          lines: [
            ...blocks.flatMap((b) => b.lines),
            {points: [[40, 20, 20], [60, 20, 44]]},
            {points: [[100, 20, 44], [120, 20, 68]]},
            {points: [[160, 20, 68], [180, 20, 92]]},
            rect("xz", 190, 210, 82, 102, 40),
          ],
          hidden: blocks.flatMap((b) => b.hidden),
        },
      ],
      marks: [[200, 40, 92]],
      // A payment passing through each block in turn and settling in the last.
      movers: [
        {
          key: "settle",
          path: [[20, 20, 20], [40, 20, 20], [60, 20, 44], [100, 20, 44], [120, 20, 68], [160, 20, 68], [180, 20, 92], [200, 40, 92]],
        },
      ],
    };
  })(),
  /** A phone with two payment cards lifting off its screen. */
  phone: (() => {
    const body = box(0, 0, 0, 72, 132, 7);
    return {
      parts: [
        {key: "body", lines: [...body.lines, rect("xy", 6, 66, 10, 122, 7)], hidden: body.hidden},
        {
          key: "cards",
          lines: [
            rect("xy", 12, 60, 22, 56, 30),
            rect("xy", 12, 60, 66, 100, 52),
            {points: [[16, 28, 30], [36, 28, 30]]},
            {points: [[16, 72, 52], [44, 72, 52]]},
            {points: [[60, 22, 7], [60, 22, 30]]},
            {points: [[60, 56, 7], [60, 56, 30]]},
            {points: [[60, 66, 7], [60, 66, 52]]},
            {points: [[60, 100, 7], [60, 100, 52]]},
          ],
          // The stilts at the cards' back corners are under the cards.
          hidden: [{points: [[12, 22, 7], [12, 22, 30]]}, {points: [[12, 66, 7], [12, 66, 52]]}],
        },
      ],
      movers: [
        {key: "lift", index: 0, path: [[60, 56, 7], [60, 56, 30]]},
        {key: "lift", index: 1, path: [[60, 100, 7], [60, 100, 52]]},
      ],
    };
  })(),
  /** A bank: a plinth, a hall with four pilasters on its front, the beam, the roof and a coin. */
  bank: (() => {
    const plinth = box(0, 0, 0, 104, 64, 8);
    const hall = walls(10, 10, 8, 84, 44, 44);
    const beam = box(2, 2, 52, 100, 60, 8);
    // Each pilaster is its two sides: its foot and head lie on the hall's edges.
    const pilasters = [20, 39, 58, 77].flatMap((x): Poly[] => [{points: [[x, 54, 8], [x, 54, 52]]}, {points: [[x + 7, 54, 8], [x + 7, 54, 52]]}]);
    return {
      parts: [
        {
          key: "body",
          lines: [
            ...plinth.lines,
            ...hall.lines,
            ...pilasters,
            ...beam.lines,
            // The roof: the front gable, the ridge, and the far eaves, which are its outline.
            {points: [[2, 62, 60], [52, 62, 78], [102, 62, 60]]},
            {points: [[2, 2, 60], [52, 2, 78], [102, 2, 60]]},
            {points: [[52, 2, 78], [52, 62, 78]]},
          ],
          hidden: [...plinth.hidden, ...hall.hidden, ...beam.hidden],
        },
        {key: "coin", flash: true, lines: [circle([52, 62, 67], 5, "xz", 24)]},
      ],
    };
  })(),
  /** The exchange: two coins, and one way and the other between them. */
  exchange: (() => {
    // The second coin sits level with the first on screen: (+60, -60) moves only across. The
    // way over starts and ends a little behind the coins' middles and the way back a little in
    // front and lower, so their arrowheads stand apart.
    const a = coin(24, 24, 0, 20, 7), b = coin(84, -36, 0, 20, 7);
    return {
      parts: [
        {key: "coins", lines: [...a.lines, ...b.lines], hidden: [...a.hidden, ...b.hidden]},
        {key: "over", lines: hop([26, 18, 16], [78, -34, 16], 40)},
        {key: "back", lines: hop([86, -26, 13], [34, 26, 13], 20)},
      ],
    };
  })(),
} satisfies Record<string, Shape>;

export type DrawingName = keyof typeof SHAPES;

const fmt = (n: number) => Number(n.toFixed(2));
const PAD = 4;

type ProjectedPart = {
  key: string;
  index?: number;
  d: string;
  dh: string;
  /** For a plane part: the matrix from its own coordinates to the drawing's. */
  matrix?: string;
  /** One path per line, for the reveal mask (in the plane's coordinates for a plane part). */
  reveal: string[];
  loop?: boolean;
  flash?: boolean;
};

type Projected = {
  w: number;
  h: number;
  /** How many lines the reveal draws, which sets its stagger. */
  n: number;
  parts: ProjectedPart[];
  marks: Flat[];
  movers: Array<{key: string; index?: number; points: Flat[]}>;
};

const pathOf = (points: readonly Flat[], closed?: boolean) =>
  points.map(([x, y], i) => `${i ? "L" : "M"}${fmt(x)} ${fmt(y)}`).join("") + (closed ? "Z" : "");

/**
 * Projected once: every part's paths, the marks and the movers, shifted so the
 * drawing starts at (PAD, PAD) and its viewBox at the origin. CSS transforms
 * on SVG elements (the turning dial, the movers) are then in plain user units.
 */
function projectShape(shape: Shape): Projected {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = ([x, y]: Flat) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  const linear = (v: Vec): Flat => project(v);
  const flatToScreen = (plane: NonNullable<Part["plane"]>, [a, b]: Flat): Flat => {
    const [ox, oy] = project(plane.origin), [ux, uy] = linear(plane.u), [vx, vy] = linear(plane.v);
    return [ox + a * ux + b * vx, oy + a * uy + b * vy];
  };
  for (const part of shape.parts) {
    for (const poly of [...(part.lines ?? []), ...(part.hidden ?? [])]) poly.points.forEach((p) => grow(project(p)));
    if (part.plane) for (const poly of part.plane.lines) poly.points.forEach((p) => grow(flatToScreen(part.plane!, p)));
  }
  for (const mark of shape.marks ?? []) {
    const [x, y] = project(mark);
    grow([x - 7, y - 7]);
    grow([x + 7, y + 7]);
  }
  const ox = PAD - minX, oy = PAD - minY;
  const shift = (v: Vec): Flat => {
    const [x, y] = project(v);
    return [x + ox, y + oy];
  };
  let n = 0;
  const parts = shape.parts.map((part): ProjectedPart => {
    const lines = (part.lines ?? []).map((poly) => pathOf(poly.points.map(shift), poly.closed));
    const hidden = (part.hidden ?? []).map((poly) => pathOf(poly.points.map(shift), poly.closed));
    if (part.plane) {
      const [px, py] = project(part.plane.origin), [ux, uy] = linear(part.plane.u), [vx, vy] = linear(part.plane.v);
      const local = part.plane.lines.map((poly) => pathOf(poly.points, poly.closed));
      n += local.length;
      return {
        key: part.key,
        index: part.index,
        d: local.join(""),
        dh: "",
        matrix: `matrix(${[ux, uy, vx, vy, px + ox, py + oy].map(fmt).join(",")})`,
        reveal: local,
      };
    }
    n += lines.length + hidden.length;
    return {key: part.key, index: part.index, d: lines.join(""), dh: hidden.join(""), reveal: [...lines, ...hidden], loop: part.loop, flash: part.flash};
  });
  return {
    w: fmt(maxX - minX + PAD * 2),
    h: fmt(maxY - minY + PAD * 2),
    n,
    parts,
    marks: (shape.marks ?? []).map(shift),
    movers: (shape.movers ?? []).map((m) => ({key: m.key, index: m.index, points: m.path.map(shift)})),
  };
}

const PROJECTED = Object.fromEntries(
  (Object.entries(SHAPES) as [DrawingName, Shape][]).map(([name, shape]) => [name, projectShape(shape)]),
) as Record<DrawingName, Projected>;

/** Custom properties for a mover: its waypoints, in user units. */
const moverVars = (points: Flat[], index = 0) => {
  const vars: Record<string, string | number> = {"--i": index};
  points.forEach(([x, y], i) => {
    vars[`--x${i}`] = `${fmt(x)}px`;
    vars[`--y${i}`] = `${fmt(y)}px`;
  });
  return vars as CSSProperties;
};

/**
 * A dotted isometric drawing. `marked` adds the brand-purple square, framed, on
 * the drawing's datum. `quiet` slows its loops, for drawings shown small and
 * several at once.
 */
export function Drawing({name, className, marked = false, quiet = false}: {name: DrawingName; className?: string; marked?: boolean; quiet?: boolean}) {
  // An id that is safe inside url(#…) whatever React's id format is.
  const id = `dw${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const {w, h, n, parts, marks, movers} = PROJECTED[name];
  let line = 0;
  return (
    <svg
      className={[styles.drawing, className].filter(Boolean).join(" ")}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      focusable="false"
      fill="none"
      data-draw=""
      data-name={name}
      data-quiet={quiet || undefined}
      style={{"--n": n} as CSSProperties}
    >
      <defs>
        <mask id={`${id}-in`} maskUnits="userSpaceOnUse" x="0" y="0" width={w} height={h}>
          <rect className={styles.maskFill} width={w} height={h} fill="#fff" />
          <g stroke="#fff" strokeWidth="7" strokeLinejoin="round">
            {parts.map((part) => {
              const paths = part.reveal.map((d) => <path key={line} className={styles.maskLine} d={d} pathLength={1} style={{"--i": line++} as CSSProperties} />);
              return part.matrix ? (
                <g key={part.key} transform={part.matrix}>
                  {paths}
                </g>
              ) : (
                paths
              );
            })}
          </g>
        </mask>
        {parts
          .filter((part) => part.loop)
          .map((part) => (
            <mask key={part.key} id={`${id}-${part.key}`} maskUnits="userSpaceOnUse" x="0" y="0" width={w} height={h}>
              <g stroke="#fff" strokeWidth="7" strokeLinejoin="round">
                {part.reveal.map((d, i) => (
                  <path key={i} className={styles.loopLine} d={d} pathLength={1} style={{"--i": i} as CSSProperties} />
                ))}
              </g>
            </mask>
          ))}
      </defs>
      <g mask={`url(#${id}-in)`} stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
        {parts.map((part, i) => (
          <g
            key={`${part.key}-${i}`}
            className={part.matrix ? styles.plane : undefined}
            data-part={part.key}
            transform={part.matrix}
            mask={part.loop ? `url(#${id}-${part.key})` : undefined}
            style={{"--i": part.index ?? 0, "--plane": part.matrix} as CSSProperties}
          >
            {part.dh ? <path className={styles.hidden} d={part.dh} /> : null}
            <path className={styles.edge} d={part.d} />
            {part.flash ? <path className={styles.flash} d={part.d} /> : null}
          </g>
        ))}
      </g>
      {movers.map((mover, i) => (
        <rect key={i} className={styles.mover} data-mover={mover.key} x="-2.25" y="-2.25" width="4.5" height="4.5" fill="currentColor" style={moverVars(mover.points, mover.index)} />
      ))}
      {marked
        ? marks.map(([x, y]) => (
            <g key={`${x}-${y}`} className={styles.mark}>
              {/* The Rein mark where the drawing's datum sits, in the brand purple. */}
              {/* Placed by the group, so the pulse's CSS transform on the path cannot displace it. */}
              <g transform={`translate(${x - (MARK_WIDTH * 0.14) / 2} ${y - (MARK_HEIGHT * 0.14) / 2}) scale(0.14)`}>
                <path className={styles.markCore} d={MARK_PATH} fill="var(--sl-accent, #5b21b6)" fillRule="evenodd" />
              </g>
            </g>
          ))
        : null}
    </svg>
  );
}

/* --- Glyphs ------------------------------------------------------------------
   Thin, square-ended, drawn on a 16px grid to sit in the 40px tiles. */

const glyph = (d: string) =>
  function Glyph({className}: {className?: string}) {
    return (
      <svg className={className} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none">
        <path d={d} stroke="currentColor" strokeWidth="1.25" />
      </svg>
    );
  };

export const ArrowGlyph = glyph("M2.5 8h11M9 3.5 13.5 8 9 12.5");
export const ArrowUpGlyph = glyph("M8 13.5v-11M3.5 7 8 2.5 12.5 7");
export const PlusGlyph = glyph("M8 2.5v11M2.5 8h11");
