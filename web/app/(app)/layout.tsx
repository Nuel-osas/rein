import "@/components/app/theme.css";
import {WalletProvider} from "@/lib/wallet";

/** Chain state is read per visit in the browser; nothing here is prerendered with stale figures. */
export const dynamic = "force-dynamic";

export default function AppLayout({children}: {children: React.ReactNode}) {
  return <WalletProvider>{children}</WalletProvider>;
}
