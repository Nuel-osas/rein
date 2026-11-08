import {redirect} from "next/navigation";
import {onboardingHref} from "@/lib/return-to";

type Props = {searchParams: Promise<{next?: string | string[]}>};

/**
 * Nuntio has one way in, /onboarding, and no /signin. Rein's earlier /signin links keep working by
 * redirecting there, with the return-to path (?next=) carried over when it is a safe local path.
 */
export default async function SignInPage({searchParams}: Props) {
  const {next} = await searchParams;
  redirect(onboardingHref(typeof next === "string" ? next : null));
}
