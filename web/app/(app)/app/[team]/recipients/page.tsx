import type {Metadata} from "next";
import {ServiceList} from "@/components/app/screens/Services";

export const metadata: Metadata = {title: "Services | Rein"};

/** Nuntio's Recipients. Rein pays only registered services, so this lists the on-chain registry. */
export default function RecipientsPage() {
  return <ServiceList />;
}
