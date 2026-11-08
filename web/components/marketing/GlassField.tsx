"use client";

import {useEffect, useRef} from "react";

/* ===========================================================================
   A moving field of brand purple seen through fluted glass.

   One WebGL fragment shader, no library. A still gradient (black into Rein
   purple) sits behind straight vertical glass ribs, and bands of light sweep
   across it from left to right. Each rib shows a mirrored, compressed slice of
   what is behind it, with a soft highlight on its left edge and a shadow on its
   right, so the light breaks into the ribs as it passes. The same look as the X
   banner on X, made smoother and alive.

   Decoration only: `aria-hidden`, `pointer-events: none`, and the page reads
   the same without it. Before hydration, without WebGL, or if the context is
   lost, the parent's CSS gradient is what shows.

   It costs nothing when nobody is looking. The loop stops off screen, in a
   hidden tab, while `paused`, and for anyone who asked for reduced motion, who
   gets a single still frame instead. Resolution is capped at 1.5x.
   =========================================================================== */

type GlassVariant = "hero" | "panel";

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uRib;
uniform float uVariant;

// Linear stops through the brand palette: #0a0a0b, #1e0b3d, #4c1d95, #5b21b6, #7c3aed, #ddd6fe.
vec3 ramp(float t) {
  vec3 c0 = vec3(0.039, 0.039, 0.043);
  vec3 c1 = vec3(0.118, 0.043, 0.239);
  vec3 c2 = vec3(0.298, 0.114, 0.584);
  vec3 c3 = vec3(0.357, 0.129, 0.714);
  vec3 c4 = vec3(0.486, 0.227, 0.929);
  vec3 c5 = vec3(0.867, 0.839, 0.996);
  t = clamp(t, 0.0, 1.0);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.48) return mix(c1, c2, (t - 0.25) / 0.23);
  if (t < 0.66) return mix(c2, c3, (t - 0.48) / 0.18);
  if (t < 0.84) return mix(c3, c4, (t - 0.66) / 0.18);
  return mix(c4, c5, (t - 0.84) / 0.16);
}

// A band of light at 0..1 across, entering on the left and leaving on the right. OFFSET
// staggers bands along the cycle so one is always somewhere on the glass.
float sweep(vec2 q, float offset, float slant, float width) {
  float x = -0.35 + 1.7 * fract(uTime / 11.0 + offset);
  float d = q.x - x - (q.y - 0.5) * slant;
  return exp(-d * d / width);
}

// q: 0..1 across and down (y = 0 at the top). Still, apart from the sweeping light.
float field(vec2 q) {
  float y = q.y;
  float t;
  if (uVariant < 0.5) {
    // Hero: dark behind the headline, brighter toward the preview below it. The light is kept
    // softer across the top, so the headline stays white on deep purple as it passes.
    t = 0.10 + 0.55 * y;
    t += 0.05 * sin(q.x * 4.0 + 0.6);
    t += 0.10 * exp(-pow(q.x - 0.86, 2.0) / 0.05 - pow(y - 0.70, 2.0) / 0.08);
    float weight = 0.45 + 0.55 * smoothstep(0.25, 0.80, y);
    t += 0.28 * weight * (sweep(q, 0.0, 0.30, 0.018) + 0.6 * sweep(q, 0.5, 0.30, 0.010));
  } else {
    // Panel: deep black with a glow rising from the lower left.
    t = 0.05 + 0.44 * exp(-(pow(q.x - 0.22, 2.0) / 0.22 + pow(y - 1.05, 2.0) / 0.32));
    t += 0.04 * sin(q.x * 3.0 + 1.1);
    t += 0.20 * (sweep(q, 0.0, 0.35, 0.016) + 0.6 * sweep(q, 0.5, 0.35, 0.009));
  }
  return t;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  // Straight vertical ribs. Only the light behind them moves.
  float u = fract(p.x / uRib);
  // Refraction: each rib shows a mirrored, compressed slice of the field.
  float xs = p.x + (0.5 - u) * uRib * 1.35;
  vec3 col = ramp(field(vec2(xs, p.y) / uRes));
  float lum = dot(col, vec3(0.30, 0.59, 0.11));
  float spec = 0.12 * exp(-pow((u - 0.20) / 0.10, 2.0)) + 0.06 * exp(-pow((u - 0.03) / 0.025, 2.0));
  float shade = 0.14 * exp(-pow((u - 0.95) / 0.10, 2.0));
  col *= 1.0 - shade;
  col += (1.0 - col) * spec * (0.30 + 0.70 * lum);
  // A trace of grain, so the gradient never bands.
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) * (2.0 / 255.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Rib width in CSS pixels: wide and calm in the hero, a little finer in the narrow panel. */
const RIB: Record<GlassVariant, number> = {hero: 64, panel: 48};
/** The still frame shown to anyone who asked for reduced motion. */
const STILL_AT = 8;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function GlassField({variant, paused = false, className}: {variant: GlassVariant; paused?: boolean; className?: string}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  const syncRef = useRef<() => void>(() => {});

  useEffect(() => {
    pausedRef.current = paused;
    syncRef.current();
  }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === "undefined") return;
    const gl = canvas.getContext("webgl", {antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "low-power"});
    if (!gl) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    // One triangle that covers the whole viewport.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "uRes");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uRib = gl.getUniformLocation(program, "uRib");
    const uVariant = gl.getUniformLocation(program, "uVariant");
    gl.uniform1f(uVariant, variant === "hero" ? 0 : 1);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let dpr = 1;
    let elapsed = STILL_AT;
    let last = 0;
    let raf = 0;
    let visible = true;
    let lost = false;

    const draw = () => {
      if (lost) return;
      gl.uniform1f(uTime, reduce.matches ? STILL_AT : elapsed);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.uniform2f(uRes, width, height);
      gl.uniform1f(uRib, RIB[variant] * dpr);
      draw();
    };

    const loop = (now: number) => {
      if (last) elapsed += Math.min(now - last, 100) / 1000;
      last = now;
      draw();
      raf = requestAnimationFrame(loop);
    };

    const sync = () => {
      const run = visible && !document.hidden && !reduce.matches && !pausedRef.current && !lost;
      if (run && !raf) {
        last = 0;
        raf = requestAnimationFrame(loop);
      } else if (!run && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    syncRef.current = sync;

    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      sync();
    });
    observer.observe(canvas);
    const resizer = new ResizeObserver(resize);
    resizer.observe(canvas);
    const onMotion = () => {
      draw();
      sync();
    };
    reduce.addEventListener("change", onMotion);
    document.addEventListener("visibilitychange", sync);
    const onLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      sync();
    };
    canvas.addEventListener("webglcontextlost", onLost);

    resize();
    canvas.dataset.ready = "true";
    sync();

    return () => {
      cancelAnimationFrame(raf);
      raf = 0;
      syncRef.current = () => {};
      observer.disconnect();
      resizer.disconnect();
      reduce.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", sync);
      canvas.removeEventListener("webglcontextlost", onLost);
    };
  }, [variant]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" data-glass={variant} />;
}
