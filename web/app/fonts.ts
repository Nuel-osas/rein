import localFont from "next/font/local";

/**
 * Two faces, two jobs. Nothing else.
 *
 * A payments interface is mostly numbers and short labels, so a large type system is
 * liability rather than range. The prior products this team shipped ended up with five
 * faces across three surfaces and a font bug that rendered every heading in the wrong
 * family for weeks, because one CSS variable in a stack was undefined and an undefined
 * variable invalidates the whole declaration.
 */

/**
 * Neue Montreal — legacy fallback for older editorial components.
 *
 * `display: "swap"` with a metric-matched fallback, so the page does not reflow when the
 * real face arrives.
 */
export const neue = localFont({
  src: [
    {path: "../fonts/NeueMontreal-Light.woff2", weight: "300", style: "normal"},
    {path: "../fonts/NeueMontreal-Regular.woff2", weight: "400", style: "normal"},
    {path: "../fonts/NeueMontreal-Medium.woff2", weight: "500", style: "normal"},
    {path: "../fonts/NeueMontreal-Bold.woff2", weight: "700", style: "normal"},
  ],
  variable: "--font-neue",
  display: "swap",
  preload: false,
  fallback: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

/**
 * SF Pro Rounded — the leading face across every product surface.
 *
 * Self-hosted rather than reached through the `ui-rounded` generic, so a balance renders
 * identically on Windows and Android instead of only looking right on Apple hardware.
 * One weight; heavier display cuts synthesise from it.
 *
 * ========================= SUBSET, BECAUSE IT IS PRELOADED EVERYWHERE =========================
 * This face is preloaded on every route (a `<link rel="preload">` on static pages, an HTTP `Link`
 * header on dynamic ones), so its size is paid before first paint on every first visit. The full
 * file was 1,177,928 bytes: 14,707 glyphs, about 13,000 of them SF Symbols in the private-use
 * planes, plus Greek and Cyrillic. That was more than five times all the JavaScript on the
 * landing page. The file in `fonts/` is now 62,740 bytes, a subset of the same file with:
 *
 *   Latin, Latin-1, Latin Extended (Google Fonts' `latin` + `latin-ext` ranges), the currency
 *   signs (U+20A0-20C0), letterlike symbols, number forms, arrows, math operators, box drawing,
 *   geometric shapes, miscellaneous symbols and dingbats;
 *   OpenType features kern, calt, ccmp, locl, case, pnum and tnum (70 rules use `tabular-nums`;
 *   the original's `liga` only assembled SF Symbols, so none of it applies to text);
 *   the name table whole, licence text included.
 *
 * Outlines, advances and vertical metrics are byte-for-byte the original's (checked glyph by
 * glyph when it was cut), so nothing reflows. A character outside the subset (a name in Greek or
 * Cyrillic) falls back per character to the stack below, which is what the browser did for
 * every character before the face loaded. The original is in git history (before 2026-10-12);
 * to cut it again with fontTools:
 *
 *   pyftsubset SFProRounded-Regular.woff2 --flavor=woff2 --name-IDs='*' --name-languages='*' \
 *     --layout-features='kern,calt,ccmp,liga,locl,tnum,pnum,case' \
 *     --unicodes='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,
 *       U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD,U+0100-02BA,
 *       U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20C0,
 *       U+2113,U+2C60-2C7F,U+A720-A7FF,U+2100-214F,U+2150-218F,U+2190-21FF,U+2200-22FF,
 *       U+2500-257F,U+25A0-25FF,U+2600-26FF,U+2700-27BF'
 *
 * `app/fonts.test.ts` holds the budget, so the full file cannot come back unnoticed.
 * ===============================================================================================
 */
export const rounded = localFont({
  src: [{path: "../fonts/SFProRounded-Regular.woff2", weight: "400", style: "normal"}],
  variable: "--font-rounded-face",
  display: "swap",
  preload: true,
  fallback: ["ui-rounded", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

/** Applied once on `<html>`. Every `var()` below it resolves because both are always set. */
/**
 * Applied once on `<html>`.
 *
 * The face variables are deliberately named `--font-neue` and
 * `--font-rounded-face`, distinct from the `--font-sans` / `--font-rounded`
 * tokens that consume them. A token that reads a variable of its own name is a
 * CSS cycle, which is invalid at computed-value time and takes the fallback
 * down with it.
 */
export const fontVariables = `${neue.variable} ${rounded.variable}`;
