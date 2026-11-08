import {SpenderForm} from "@/components/app/screens/SpenderForm";

export default async function EditSpenderPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  return <SpenderForm mode="edit" spenderId={decodeURIComponent(id)} />;
}
