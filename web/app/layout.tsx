import type {Metadata} from "next";
import {fontVariables} from "./fonts";
import "./globals.css";
import "./theme-dark.css";

const TITLE = "Rein | Spending rules for teams and their AI agents";
const DESCRIPTION =
  "A team vault on Solana where every person and every AI agent pays under a policy the program enforces. Over a limit, the payment waits on chain until the owner approves it.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Rein",
  openGraph: {type: "website", siteName: "Rein", url: "/", title: TITLE, description: DESCRIPTION},
  twitter: {card: "summary_large_image", title: TITLE, description: DESCRIPTION},
};

/** Light marketing sections by default; the hero, the bands and the whole app are dark. */
export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={fontVariables} data-theme="light">
      <body>{children}</body>
    </html>
  );
}
