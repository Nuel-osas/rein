import type {Metadata} from "next";
import {GlobalScreen} from "@/components/app/screens/Global";

export const metadata: Metadata = {title: "Verify | Rein"};

/** Nuntio's Verify. Rein has no fiat backend, so the page says so instead of showing balances. */
export default function GlobalVerifyPage() {
  return <GlobalScreen page="verify" />;
}
