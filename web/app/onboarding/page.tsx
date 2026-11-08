import type {Metadata} from "next";
import {SignInExperience} from "@/components/onboarding/SignInExperience";
import {WalletProvider} from "@/lib/wallet";

export const metadata: Metadata = {title: "Get started | Rein"};

/**
 * Rein's sign-in and onboarding, at the address people expect for "get started". It is the same
 * screen as /signin and /auth/callback, one component behind three doors, so the three cannot drift:
 * Google through Privy, then the person's team or the form to create one.
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
