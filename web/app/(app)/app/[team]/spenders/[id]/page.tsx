import {SpenderDetail} from "@/components/app/screens/SpenderDetail";

export default async function SpenderPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  return <SpenderDetail by="address" id={decodeURIComponent(id)} />;
}
