import type {Metadata} from "next";
import {AppFrame} from "@/components/app/AppFrame";
import {TeamScope} from "@/components/app/rein/context";
import {EmptyState} from "@/components/app/ui";
import {parseAddress} from "@/lib/chain";

type Props = {children: React.ReactNode; params: Promise<{team: string}>};

export const metadata: Metadata = {title: "Team | Rein"};

/** Every screen under /app/<team> is readable by anyone, wallet or not. */
export default async function TeamLayout({children, params}: Props) {
  const {team: raw} = await params;
  const team = parseAddress(decodeURIComponent(raw));
  if (!team) {
    return (
      <AppFrame team={null}>
        <EmptyState as="h1" title="Not a team address" body="A team link looks like /app/<team account>, with a base58 Solana address." />
      </AppFrame>
    );
  }
  return (
    <AppFrame team={team}>
      <TeamScope team={team}>{children}</TeamScope>
    </AppFrame>
  );
}
