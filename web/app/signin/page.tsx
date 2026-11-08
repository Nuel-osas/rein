import type {Metadata} from "next";
import {SignInExperience} from "@/components/onboarding/SignInExperience";
import {WalletProvider} from "@/lib/wallet";

export const metadata: Metadata = {title: "Sign in | Rein"};

/** A route that mounts Privy is never prerendered: the provider needs the browser and the app id. */
export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <WalletProvider>
      <SignInExperience />
    </WalletProvider>
  );
}
