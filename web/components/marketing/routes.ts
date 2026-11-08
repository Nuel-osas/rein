/** Where "Open the app" goes: the team chooser, which also opens the demo team. */
export const APP_HREF = "/app";

/** The public, no-wallet demo of the seeded team. */
export const DEMO_HREF = "/demo";

/** Routes entered with a plain anchor, so the landing page does not prefetch the wallet bundle. */
export const APP_ROUTES: ReadonlySet<string> = new Set([APP_HREF]);
