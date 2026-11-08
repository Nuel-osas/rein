import {SpenderDetail} from "@/components/app/screens/SpenderDetail";

export default async function AgentPage({params}: {params: Promise<{key: string}>}) {
  const {key} = await params;
  return <SpenderDetail by="authority" id={decodeURIComponent(key)} />;
}
