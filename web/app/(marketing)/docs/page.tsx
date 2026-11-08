import type {Metadata} from "next";
import {notFound} from "next/navigation";

import {DocsView} from "@/components/marketing/docs/DocsView";
import {getDocPage} from "@/lib/docs";

/**
 * /docs: the welcome page of the documentation (content/docs/README.md).
 * Every other page is `docs/[...slug]`. Both are rendered to static HTML at build.
 */

export function generateMetadata(): Metadata {
  const page = getDocPage([]);
  return {
    title: "Docs | Rein",
    description:
      page?.description ||
      "How Rein works: a team vault on Solana where every person and every AI agent pays under a policy the program enforces.",
  };
}

export default function DocsHome() {
  const page = getDocPage([]);
  if (!page) notFound();
  return <DocsView page={page} />;
}
