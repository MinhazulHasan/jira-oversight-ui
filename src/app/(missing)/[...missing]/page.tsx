import type { Metadata } from "next";
import { notFound } from "next/navigation";

/**
 * The tab's title for an address that matches no page: a nested not-found's own metadata is not applied (only the
 * root's is), so the page that raises it names the tab instead (SQA: it read just "Jira Oversight").
 */
export const metadata: Metadata = { title: "Page not found" };

/** Every address that matches no page lands here (see ../layout.tsx). */
export default function MissingPage(): never {
  notFound();
}
