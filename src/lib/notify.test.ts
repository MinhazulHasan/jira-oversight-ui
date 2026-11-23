import { describe, expect, it, vi } from "vitest";

/*
 * A toast reused by id (the JO-12 check). Sonner updates a toast in place when
 * its id is reused, but one that has begun to leave takes the update with it:
 * a second Findings filter chosen just as the first one's toast left was never
 * acknowledged. notify keeps the in-place update while the toast is on screen,
 * and puts a fresh toast in the place of one that is leaving.
 */

type Shown = { title: string; options: { id?: string; description?: string; onAutoClose?: () => void; onDismiss?: () => void } };
const { shown, dismissed } = vi.hoisted(() => ({ shown: [] as Shown[], dismissed: [] as unknown[] }));

vi.mock("sonner", () => ({
  toast: Object.assign(
    (title: string, options: Shown["options"]) => {
      shown.push({ title, options });
      return options.id ?? shown.length;
    },
    {
      dismiss: (id?: unknown) => {
        dismissed.push(id);
        return id;
      },
    },
  ),
}));

const { notify } = await import("./notify");
const last = () => shown.at(-1)!.options;

describe("a toast reused by id", () => {
  it("is updated in place while on screen, and replaced by a fresh one once it has begun to leave", () => {
    notify.info("Filter applied", { description: "Person: Carmen Ruiz", id: "filters" });
    const first = last().id;
    notify.info("Filter applied", { description: "Person: Carmen Ruiz, Ada Brooks", id: "filters" });
    // On screen: the same toast, its words replaced, never a second one stacked.
    expect(last().id).toBe(first);

    // Its time is up: sonner says so as it starts to leave, and the next choice gets a toast of its own.
    last().onAutoClose!();
    notify.info("Filter applied", { description: "Person: Carmen Ruiz, Unassigned", id: "filters" });
    const second = last().id;
    expect(second).not.toBe(first);

    // Closed by the reader: the same.
    last().onDismiss!();
    notify.info("Filters cleared", { description: "Showing every open finding.", id: "filters" });
    const third = last().id;
    expect(third).not.toBe(second);

    // A late word from a toast already replaced changes nothing: the one on screen is still updated in place.
    shown[0].options.onDismiss!();
    notify.info("Filter applied", { description: "Severity: Breach", id: "filters" });
    expect(last().id).toBe(third);
    expect(last().description).toBe("Severity: Breach");

    // Dismissed by the caller's id: the toast standing for it.
    notify.dismiss("filters");
    expect(dismissed.at(-1)).toBe(third);
  });

  it("keeps each id's toast apart, and leaves a toast without an id to sonner", () => {
    notify.warn("Couldn't get an answer", { id: "ask" });
    notify.info("Person chosen", { id: "people" });
    expect(shown.at(-2)!.options.id).not.toBe(last().id);
    notify.ok("Link copied");
    expect(last().id).toBeUndefined();
    notify.dismiss();
    expect(dismissed.at(-1)).toBeUndefined();
  });
});
