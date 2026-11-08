import type {Metadata} from "next";
import {notFound} from "next/navigation";

import {DocsView} from "@/components/marketing/docs/DocsView";
import {docsPages, getDocPage} from "@/lib/docs";

/**
 * One documentation page, from content/docs. The list of pages is SUMMARY.md, so a path that
 * is not in it is a 404 rather than a render attempt: every page is built ahead of time.
 */

type Props = {params: Promise<{slug: string[]}>};

export const dynamicParams = false;

export function generateStaticParams() {
  return docsPages()
    .filter((p) => p.slug.length > 0)
    .map((p) => ({slug: p.slug}));
}

export async function generateMetadata({params}: Props): Promise<Metadata> {
  const page = getDocPage((await params).slug);
  if (!page) return {};
  return {
    title: `${page.title} | Rein docs`,
    description: page.description || undefined,
  };
}

export default async function DocsPage({params}: Props) {
  const page = getDocPage((await params).slug);
  if (!page) notFound();
  return <DocsView page={page} />;
}
