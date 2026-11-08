import type {Metadata} from "next";
import type {ReactNode} from "react";
import "@/components/app/theme.css";
import {WalletProvider} from "@/lib/wallet";

/**
 * Nuntio's integration and state spikes, ported. Development instruments, not product: unlinked
 * from the app and never indexed. Unlike Nuntio's they are not switched off in production, because
 * they only read public chain data and sign nothing; remove this folder to drop them.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = {robots: {index: false, follow: false}};

export default function SpikeLayout({children}: {children: ReactNode}) {
  return <WalletProvider>{children}</WalletProvider>;
}
