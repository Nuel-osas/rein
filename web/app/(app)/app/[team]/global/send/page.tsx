import type {Metadata} from "next";
import {GlobalScreen} from "@/components/app/screens/Global";

export const metadata: Metadata = {title: "Send abroad | Rein"};

/** Nuntio's Send abroad. Rein has no fiat backend, so the page says so instead of showing balances. */
export default function GlobalSendPage() {
  return <GlobalScreen page="send" />;
}
