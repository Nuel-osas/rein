import type {Metadata} from "next";
import {ServiceDetail} from "@/components/app/screens/Services";

export const metadata: Metadata = {title: "Service | Rein"};

/** One registered service, by its id (or its account address), and this team's payments to it. */
export default async function RecipientPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  return <ServiceDetail id={decodeURIComponent(id)} />;
}
