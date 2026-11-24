import { notify } from "./notify";

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
