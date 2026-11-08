import type {Metadata} from "next";
import {OwnTeamGate} from "@/components/app/OwnTeamGate";

export const metadata: Metadata = {title: "Rein"};

/**
 * The top-level app routes (/dashboard, /spenders, /approvals, …) for the signed-in person's
 * own team. The gate sends a signed-out visit to /onboarding with the path to come back to, and a
 * person with no team to /teams/new. The pages are the same ones /app/<team>/… renders.
 *
 * Never prerendered: the session and the team are read per visit in the browser.
 */
export const dynamic = "force-dynamic";

export default function OwnTeamLayout({children}: {children: React.ReactNode}) {
  return <OwnTeamGate>{children}</OwnTeamGate>;
}
