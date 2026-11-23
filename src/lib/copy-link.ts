import { notify } from "./notify";

/**
 * Copy the address of the current view. The URL holds every filter, the sort
 * and the open drawer, so the link reopens exactly what the reader sees.
 */
export async function copyCurrentLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(window.location.href);
    notify.ok("Link copied", { description: "It opens this exact view, filters included." });
  } catch {
    notify.warn("Could not copy the link", {
      description: "Copy it from the address bar.",
    });
  }
}
