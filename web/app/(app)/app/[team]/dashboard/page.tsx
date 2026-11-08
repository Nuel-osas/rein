import {redirect} from "next/navigation";

type Props = {params: Promise<{team: string}>};

/** Nuntio's /dashboard. In Rein the team home already is the dashboard, so this is an alias for it. */
export default async function DashboardAlias({params}: Props) {
  const {team} = await params;
  redirect(`/app/${encodeURIComponent(decodeURIComponent(team))}`);
}
