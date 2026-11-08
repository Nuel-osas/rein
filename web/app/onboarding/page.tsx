import type {Metadata} from "next";
import {SignInExperience} from "@/components/onboarding/SignInExperience";
import {WalletProvider} from "@/lib/wallet";

export const metadata: Metadata = {title: "Get started | Rein"};

/**
 * Rein's sign-in and onboarding: the one way in. It is the same screen as /auth/callback, one
 * component behind two doors, so they cannot drift (/signin redirects here): Google through Privy,
 * then the return-to path (?next=, or what an invite remembered) or /dashboard.
 *
 * A route that mounts Privy is never prerendered: the provider needs the browser and the app id.
 */
export const dynamic = "force-dynamic";

export default function OnboardingPage() {
  return (
    <WalletProvider>
      <SignInExperience />
    </WalletProvider>
  );
}
