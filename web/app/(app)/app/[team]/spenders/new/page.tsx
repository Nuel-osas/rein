import {SpenderForm} from "@/components/app/screens/SpenderForm";

type Props = {searchParams: Promise<{authority?: string | string[]; label?: string | string[]}>};

/** `?authority=…&label=…` comes from an invite reply (lib/invite.ts); the form checks both before use. */
export default async function NewSpenderPage({searchParams}: Props) {
  const {authority, label} = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  return <SpenderForm mode="add" kind="person" prefill={{authority: one(authority), label: one(label)}} />;
}
