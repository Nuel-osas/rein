import type {Metadata} from "next";
import {ServiceNew} from "@/components/app/screens/Services";

export const metadata: Metadata = {title: "Add a service | Rein"};

/** How a service gets listed. Only the registry admin can; a team never adds a payee address. */
export default function NewRecipientPage() {
  return <ServiceNew />;
}
