import { toast } from "sonner";

/**
 * Acknowledgement. Every action a reader takes is answered here: a filter
 * applied, a link copied, a question sent and answered, an export done.
 *
 * - ok: the action completed (link copied, export saved).
 * - cite: something traceable happened (an answer arrived with its figures cited).
 * - warn: it needs attention but nothing broke (stale data, a partial result).
 * - info: a neutral change of state (theme switched, filters cleared).
 *
 * A toast is never the only place information lives: it disappears.
 */

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

/**
 * For each id a caller names, the toast standing for it (sonner's own id) and
 * whether it has begun to leave. A toast reused while on screen is updated in
 * place. One that has begun to leave (its time up, or closed) would take an
 * update with it: sonner keeps it for its exit, merges the update into it and
 * then removes both, so the reader would never be told (the JO-12 check: a
 * second filter chosen just as the first one's toast left said nothing). A
 * fresh toast takes its place instead.
 */
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
