import type {Metadata} from "next";
import {GlobalScreen} from "@/components/app/screens/Global";

export const metadata: Metadata = {title: "Cards | Rein"};

/** Nuntio's Cards. Rein has no fiat backend, so the page says so instead of showing balances. */
export default function GlobalCardsPage() {
  return <GlobalScreen page="cards" />;
}
