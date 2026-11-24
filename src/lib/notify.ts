import { toast } from "sonner";

export type NotifyTone = "ok" | "cite" | "warn" | "info";

export interface NotifyOptions {
  description?: string;
  /** Milliseconds on screen. */
  duration?: number;
  /** Reuse an id to replace a toast rather than stack a second one. */
  id?: string | number;
}

// Warnings stay long enough to be read twice.
const DURATION: Record<NotifyTone, number> = { ok: 3200, cite: 3600, info: 3200, warn: 5600 };

const named = new Map<string | number, { id: string; leaving: boolean }>();
let serial = 0;

function show(tone: NotifyTone, title: string, options: NotifyOptions = {}): string | number {
  const key = options.id;
  let id: string | undefined;
  if (key !== undefined) {
    const current = named.get(key);
    if (current && !current.leaving) {
      id = current.id;
    } else {
      serial += 1;
      id = `${String(key)}~${serial}`;
      named.set(key, { id, leaving: false });
    }
  }
  const leaving = () => {
    const current = key === undefined ? undefined : named.get(key);
    if (current && current.id === id) current.leaving = true;
  };
  return toast(title, {
    description: options.description,
    duration: options.duration ?? DURATION[tone],
    id,
    className: `tone-${tone}`,
    onAutoClose: leaving,
    onDismiss: leaving,
  });
}

export const notify = {
  ok: (title: string, options?: NotifyOptions) => show("ok", title, options),
  cite: (title: string, options?: NotifyOptions) => show("cite", title, options),
  warn: (title: string, options?: NotifyOptions) => show("warn", title, options),
  info: (title: string, options?: NotifyOptions) => show("info", title, options),
  /** The toast standing for this id (as the callers name it), or every toast. */
  dismiss: (id?: string | number) => toast.dismiss(id === undefined ? undefined : (named.get(id)?.id ?? id)),
};
