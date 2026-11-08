import type {Metadata} from "next";
import {SignInExperience} from "@/components/onboarding/SignInExperience";
import {WalletProvider} from "@/lib/wallet";

export const metadata: Metadata = {title: "Sign in | Rein", robots: {index: false, follow: false}};
export const dynamic = "force-dynamic";

/**
 * Google returns here through Privy. Privy must be mounted on the return URL to finish the OAuth
 * exchange, so this is the sign-in page itself: it does not read the query string or redirect early.
 */
export default function AuthCallbackPage() {
  return (
    <WalletProvider>
      <SignInExperience />
    </WalletProvider>
  );
}
