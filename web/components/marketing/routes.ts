/** Where "Open the app" goes: Nuntio's way in, sign-in and then /dashboard. The demo team stays at /demo. */
export const APP_HREF = "/onboarding";

/** The public, no-wallet demo of the seeded team. */
export const DEMO_HREF = "/demo";

/** Routes entered with a plain anchor, so the landing page does not prefetch the wallet bundle. */
export const APP_ROUTES: ReadonlySet<string> = new Set([APP_HREF]);
