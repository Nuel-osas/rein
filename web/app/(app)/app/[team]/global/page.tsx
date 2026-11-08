import type {Metadata} from "next";
import {GlobalScreen} from "@/components/app/screens/Global";

export const metadata: Metadata = {title: "Global account | Rein"};

/** Nuntio's Global account. Rein has no fiat backend, so the page says so instead of showing balances. */
export default function GlobalAccountPage() {
  return <GlobalScreen page="account" />;
}
