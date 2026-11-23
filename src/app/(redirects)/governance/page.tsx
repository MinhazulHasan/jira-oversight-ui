import { notFound, redirect } from "next/navigation";

import { pageByKey } from "@/lib/nav";
import { currentAskLevel } from "@/server/auth/session";

/**
 * Governance (JO-12) opens on its first page, the access log. Like its pages,
 * it is people level's alone: anyone else gets the app's not-found page, as
 * if there were no such address. Answered outside the (app) group's loading
 * boundary (see ../layout.tsx), so the move is a real 307 and the not-found
 * a real 404, before anything is drawn.
 */
export default async function GovernancePage() {
  if ((await currentAskLevel()) !== "people") notFound();
  redirect(pageByKey("access_log").href);
}
