/* ===========================================================================
   The CTA vault's geometry (Vault3D.tsx): a pure function from a pose to the
   paths of every line, so the server and the browser draw the same rest pose
   and the animation only ever changes attributes.
   =========================================================================== */

type V3 = readonly [number, number, number];
type Kind = "v" | "h" | "i";
export type Pose = {yaw: number; pitch: number; door: number; wheel: number; dial: number};
type Seg = {d: string; k: Kind; z: number};

export const DEG = Math.PI / 180;

/** The pose the server draws, and the one every loop starts from. */
export const REST: Pose = {yaw: -36 * DEG, pitch: 20 * DEG, door: 13 * DEG, wheel: 18 * DEG, dial: 0};

/* The camera: distance and focal length in model units, the image centre in the viewBox. */
export const W = 480, H = 440;
const CX = 236, CY = 200, D = 620, F = 1340;
/** Half the vault's depth range, for the near-to-far fade. */
const R = 100;

/* The door's hinge line, in the body's coordinates. */
const HX = -48, HZ = 52;

const fmt = (n: number) => n.toFixed(1);

/** Points on a circle centred at `c`, in the plane of the unit vectors `u` and `v`. */
const ringPoints = (c: V3, u: V3, v: V3, r: number, steps: number, phase = 0): V3[] =>
  Array.from({length: steps}, (_, i) => {
    const t = phase + (i / steps) * Math.PI * 2;
    const a = r * Math.cos(t), b = r * Math.sin(t);
    return [c[0] + a * u[0] + b * v[0], c[1] + a * u[1] + b * v[1], c[2] + a * u[2] + b * v[2]] as const;
  });

/**
 * Every line of the vault in one pose, in a fixed order, so frame N's paths
 * are frame N+1's paths with new attributes.
 */
export function build(pose: Pose): {segs: Seg[]; core: {fill: string; frame: string}} {
  const cy = Math.cos(pose.yaw), sy = Math.sin(pose.yaw);
  const cp = Math.cos(pose.pitch), sp = Math.sin(pose.pitch);
  const cd = Math.cos(pose.door), sd = Math.sin(pose.door);

  /** Model space to camera space: yaw about the vertical, then the pitch that shows the top. */
  const view = ([x, y, z]: V3): V3 => {
    const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
    return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
  };
  const screen = ([x, y, z]: V3): [number, number] => {
    const k = F / (D - z);
    return [CX + x * k, CY - y * k];
  };
  /** The door's own coordinates to the body's: a turn about the hinge line. */
  const door = ([x, y, z]: V3): V3 => [HX + (x - HX) * cd - (z - HZ) * sd, y, HZ + (x - HX) * sd + (z - HZ) * cd];
  const doorDir = ([x, y, z]: V3): V3 => [x * cd - z * sd, y, x * sd + z * cd];
  const same = (p: V3) => p;

  /** Whether a face (outward normal `n` through point `at`, both in model space) faces the camera. */
  const facing = (n: V3, at: V3) => {
    const nv = view(n), pv = view(at);
    return -pv[0] * nv[0] - pv[1] * nv[1] + (D - pv[2]) * nv[2] > 0;
  };

  const segs: Seg[] = [];
  const line = (pts: readonly V3[], k: Kind, closed = false) => {
    const vs = pts.map(view);
    let z = 0, d = "";
    vs.forEach((p, i) => {
      z += p[2];
      const [x, y] = screen(p);
      d += `${i ? "L" : "M"}${fmt(x)} ${fmt(y)}`;
    });
    segs.push({d: closed ? `${d}Z` : d, k, z: z / vs.length});
  };
  /** Several pieces as one path, all of one kind (dotted interiors, the dial's ticks). */
  const group = (pieces: ReadonlyArray<{pts: readonly V3[]; closed?: boolean}>, k: Kind) => {
    let z = 0, n = 0, d = "";
    for (const {pts, closed} of pieces) {
      pts.forEach((p, i) => {
        const v = view(p);
        z += v[2];
        n++;
        const [x, y] = screen(v);
        d += `${i ? "L" : "M"}${fmt(x)} ${fmt(y)}`;
      });
      if (closed) d += "Z";
    }
    segs.push({d, k, z: z / Math.max(1, n)});
  };

  /**
   * A box, edge by edge: an edge is in view when either face beside it faces the camera.
   * `to` places a point and `dir` turns a normal (the door's swing, or nothing).
   */
  const box = (lo: V3, hi: V3, to: (p: V3) => V3 = same, dir: (n: V3) => V3 = same, inside = false, seen = true) => {
    const corner = (i: number): V3 => to([i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]]);
    const mid: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    // Faces as [axis][side]: does it face the camera?
    const faces = [0, 1, 2].map((axis) =>
      [0, 1].map((side) => {
        const n: V3 = [axis === 0 ? (side ? 1 : -1) : 0, axis === 1 ? (side ? 1 : -1) : 0, axis === 2 ? (side ? 1 : -1) : 0];
        const at: V3 = [axis === 0 ? (side ? hi[0] : lo[0]) : mid[0], axis === 1 ? (side ? hi[1] : lo[1]) : mid[1], axis === 2 ? (side ? hi[2] : lo[2]) : mid[2]];
        return facing(dir(n), to(at));
      }),
    );
    for (let i = 0; i < 8; i++) {
      for (const axis of [0, 1, 2]) {
        const bit = 1 << axis;
        if (i & bit) continue;
        const [a, b] = [0, 1, 2].filter((x) => x !== axis) as [number, number];
        const shown = faces[a]![(i >> a) & 1]! || faces[b]![(i >> b) & 1]!;
        line([corner(i), corner(i | bit)], inside ? "i" : shown && seen ? "v" : "h");
      }
    }
  };

  /** A short cylinder: both caps and the two lines that outline its side, as seen. */
  const cylinder = (c0: V3, c1: V3, u: V3, v: V3, r: number, k: Kind, to: (p: V3) => V3 = same) => {
    const cap0 = ringPoints(c0, u, v, r, 28).map(to), cap1 = ringPoints(c1, u, v, r, 28).map(to);
    group([{pts: cap0, closed: true}, {pts: cap1, closed: true}], k);
    const [ax, ay] = screen(view(to(c0))), [bx, by] = screen(view(to(c1)));
    let nx = -(by - ay), ny = bx - ax;
    if (Math.hypot(nx, ny) < 1e-6) [nx, ny] = [1, 0];
    const side = (pts: V3[], sign: number) => {
      let best = pts[0]!, score = -Infinity;
      for (const p of pts) {
        const [x, y] = screen(view(p));
        const s = sign * (x * nx + y * ny);
        if (s > score) [best, score] = [p, s];
      }
      return best;
    };
    group(
      [
        {pts: [side(cap0, 1), side(cap1, 1)]},
        {pts: [side(cap0, -1), side(cap1, -1)]},
      ],
      k,
    );
  };

  const X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0], Z: V3 = [0, 0, 1];
  const front = facing(Z, [0, 0, 50]);
  const doorFront = facing(doorDir(Z), door([0, 4, 52]));
  const onFront: Kind = front ? "v" : "h";
  const onDoor: Kind = doorFront && front ? "v" : "h";

  // The base, a little larger than the body, so it reads as a ledge.
  box([-66, -60, -54], [66, -50, 54]);
  // The body.
  box([-62, -50, -50], [62, 58, 50]);
  // Panels set into the top and both sides.
  line([[-52, 58, -40], [52, 58, -40], [52, 58, 40], [-52, 58, 40]], facing(Y, [0, 58, 0]) ? "v" : "h", true);
  line([[62, -40, -40], [62, -40, 40], [62, 48, 40], [62, 48, -40]], facing(X, [62, 0, 0]) ? "v" : "h", true);
  line([[-62, -40, -40], [-62, -40, 40], [-62, 48, 40], [-62, 48, -40]], facing([-1, 0, 0], [-62, 0, 0]) ? "v" : "h", true);
  // The door's opening in the front.
  line([[-48, -38, 50], [48, -38, 50], [48, 46, 50], [-48, 46, 50]], onFront, true);
  // Two hinge barrels on the hinge line.
  cylinder([HX - 1, 22, HZ], [HX - 1, 38, HZ], X, Z, 3.6, onFront);
  cylinder([HX - 1, -30, HZ], [HX - 1, -14, HZ], X, Z, 3.6, onFront);

  // The door: a slab fourteen deep, standing open by `pose.door` about the hinge line.
  // Turned away, the door is behind the body: every edge of it is hidden.
  box([-48, -38, 38], [48, 46, 52], door, doorDir, false, front);
  line(([[-42, -32, 52], [42, -32, 52], [42, 42, 52], [-42, 42, 52]] as V3[]).map(door), onDoor, true);
  // Bolts on the door's free edge: inside the frame until the door is open enough to clear it.
  const clear = pose.door > 4 * DEG;
  for (const y of [-22, 4, 30]) box([48, y - 3.5, 42], [58, y + 3.5, 48], door, doorDir, !clear, front);

  // The handle wheel: a hub, a rim, three spokes with knobs, turned by `pose.wheel`.
  const W0: V3 = [-4, 0, 52], W1: V3 = [-4, 0, 60];
  cylinder(W0, W1, X, Y, 5, onDoor, door);
  line(ringPoints(W1, X, Y, 16, 40).map(door), onDoor, true);
  const spokes = [0, 1, 2].map((i) => pose.wheel + (i * 2 * Math.PI) / 3);
  group(
    spokes.map((a) => ({pts: [5, 24].map((r): V3 => [W1[0] + r * Math.cos(a), W1[1] + r * Math.sin(a), W1[2]]).map(door)})),
    onDoor,
  );
  group(
    spokes.map((a) => ({pts: ringPoints([W1[0] + 26.6 * Math.cos(a), W1[1] + 26.6 * Math.sin(a), W1[2]], X, Y, 2.6, 12).map(door), closed: true})),
    onDoor,
  );

  // The combination dial, upper right: a short drum, ticks that turn, a fixed index mark.
  const C0: V3 = [-27, 31, 52], C1: V3 = [-27, 31, 55];
  cylinder(C0, C1, X, Y, 8, onDoor, door);
  group(
    Array.from({length: 12}, (_, i) => {
      const a = pose.dial + (i * Math.PI) / 6;
      const r0 = i % 3 === 0 ? 3.5 : 5.2;
      return {pts: [r0, 7.4].map((r): V3 => [C1[0] + r * Math.cos(a), C1[1] + r * Math.sin(a), C1[2]]).map(door)};
    }),
    onDoor,
  );
  line(([[-27, 40.5, 52], [-27, 44, 52]] as V3[]).map(door), onDoor);

  // Inside: the frame's depth, a shelf, a drawer and the core box.
  group(
    [
      {pts: [[-48, -38, 38], [48, -38, 38], [48, 46, 38], [-48, 46, 38]], closed: true},
      {pts: [[48, -38, 50], [48, -38, 38]]},
      {pts: [[48, 46, 50], [48, 46, 38]]},
    ],
    "i",
  );
  group([{pts: [[-56, 2, -44], [56, 2, -44], [56, 2, 36], [-56, 2, 36]], closed: true}], "i");
  const drawer = (lo: V3, hi: V3) => {
    const c = (i: number): V3 => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]];
    return [
      {pts: [c(0), c(1), c(3), c(2)], closed: true},
      {pts: [c(4), c(5), c(7), c(6)], closed: true},
      {pts: [c(0), c(4)]},
      {pts: [c(1), c(5)]},
      {pts: [c(2), c(6)]},
      {pts: [c(3), c(7)]},
    ];
  };
  group([...drawer([-44, -46, -40], [44, -12, 30]), {pts: [[-12, -29, 30], [12, -29, 30]]}], "i");
  group(drawer([-15, 2, -15], [15, 32, 15]), "i");

  // The core: the page's framed purple square, facing the camera from the centre of the core box,
  // sized by its depth, so it reads as a light inside at every angle of the turn.
  const [ccx, ccy, ccz] = view([0, 17, 0]);
  const [mx, my] = screen([ccx, ccy, ccz]);
  const quad = (s: number) => {
    const h = (s * F) / (D - ccz);
    return `M${fmt(mx - h)} ${fmt(my - h)}H${fmt(mx + h)}V${fmt(my + h)}H${fmt(mx - h)}Z`;
  };

  return {segs, core: {fill: quad(6), frame: quad(10)}};
}

export const opacity = (s: Seg, fade = 1) => {
  const t = Math.min(1, Math.max(0, (s.z + R) / (2 * R)));
  const o = s.k === "v" ? 0.3 + 0.58 * t : s.k === "h" ? 0.16 + 0.14 * t : 0.17 + 0.16 * t;
  return (o * fade).toFixed(3);
};
