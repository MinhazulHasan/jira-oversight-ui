import { notFound, redirect } from "next/navigation";

import { pageByKey } from "@/lib/nav";
import { currentAskLevel } from "@/server/auth/session";

export default async function GovernancePage() {
  if ((await currentAskLevel()) !== "people") notFound();
  redirect(pageByKey("access_log").href);
}
