import type {Metadata} from "next";
import {InviteAccept} from "@/components/app/screens/Invite";

export const metadata: Metadata = {title: "Join a team | Rein", robots: {index: false, follow: false}};

/**
 * An invite link, /invite/<token>. Outside the app frame and the sign-in gate on purpose, like
 * Nuntio's: it has to work for somebody who is not signed in and is on no team yet. The token is
 * decoded in the browser; nothing is stored.
 */
export default async function InvitePage({params}: {params: Promise<{token: string}>}) {
  const {token} = await params;
  return <InviteAccept token={decodeURIComponent(token)} />;
}
