import { describe, expect, it } from "vitest";

import { NAV_PAGES, pageForChord, pageForPath } from "./nav";

describe("nav", () => {
  it("gives every page a unique chord and a one-line purpose", () => {
    const chords = NAV_PAGES.map((p) => p.chord);
    expect(new Set(chords).size).toBe(chords.length);
    for (const page of NAV_PAGES) {
      expect(page.purpose.length).toBeGreaterThan(20);
      expect(page.purpose).not.toContain("\n");
    }
  });

  it("finds the page that owns a path", () => {
    expect(pageForPath("/")?.key).toBe("overview");
    expect(pageForPath("/findings")?.key).toBe("findings");
    expect(pageForPath("/findings/anything")?.key).toBe("findings");
    expect(pageForPath("/issues/DEMO-1")).toBeUndefined();
    expect(pageForPath("/findingsx")).toBeUndefined();
  });

  it("maps chord letters case-insensitively", () => {
    expect(pageForChord("I")?.href).toBe("/insights");
    expect(pageForChord("z")).toBeUndefined();
  });
});

describe("nav: Portfolio and Governance (JO-12)", () => {
  it("offers the Portfolio to every reader, first; Governance to people level alone", async () => {
    const { navPagesFor, NAV_GROUPS } = await import("./nav");
    expect(navPagesFor(false)[0].key).toBe("portfolio");
    expect(navPagesFor(false).map((page) => page.key)).not.toContain("access_log");
    expect(navPagesFor(false).map((page) => page.key)).not.toContain("usage");
    expect(navPagesFor(false).map((page) => page.key)).not.toContain("rule_settings");
    expect(navPagesFor(true).filter((page) => page.group === "governance").map((page) => page.key)).toEqual(["access_log", "usage", "rule_settings"]);
    expect(NAV_GROUPS.map((group) => group.label)).toEqual(["Oversight", "Reference", "Governance"]);
  });

  it("finds Governance's pages by path, its own address being the access log's, and the Overview at /", () => {
    expect(pageForPath("/")?.key).toBe("overview");
    expect(pageForPath("/portfolio")?.key).toBe("portfolio");
    expect(pageForPath("/governance")?.key).toBe("access_log");
    expect(pageForPath("/governance/access-log")?.key).toBe("access_log");
    expect(pageForPath("/governance/usage")?.key).toBe("usage");
  });

  it("goes to the Portfolio with g then h for anyone, and to Governance's pages only at people level", () => {
    expect(pageForChord("h")?.href).toBe("/portfolio");
    expect(pageForChord("l")).toBeUndefined();
    expect(pageForChord("l", true)?.href).toBe("/governance/access-log");
    expect(pageForChord("u", true)?.href).toBe("/governance/usage");
  });
});

describe("nav: Rule settings (JO-15)", () => {
  it("is Governance's, for people level alone, on g then r, at /governance/rules", async () => {
    const { navPagesFor, pageByKey } = await import("./nav");
    const page = pageByKey("rule_settings");
    expect(page).toMatchObject({ href: "/governance/rules", label: "Rule settings", group: "governance", chord: "r", level: "people" });
    expect(page.purpose).toBe("Turn rules on or off and set thresholds for this board.");
    expect(page.keywords).toEqual(expect.arrayContaining(["rules", "thresholds", "configure", "settings", "severity"]));
    expect(navPagesFor(false).some((candidate) => candidate.key === "rule_settings")).toBe(false);
    expect(pageForChord("r")).toBeUndefined();
    expect(pageForChord("r", true)?.href).toBe("/governance/rules");
    expect(pageForChord("R", true)?.href).toBe("/governance/rules");
  });

  it("owns its path, and leaves the Process page's own", () => {
    expect(pageForPath("/governance/rules")?.key).toBe("rule_settings");
    expect(pageForPath("/process")?.key).toBe("process");
    expect(pageForPath("/governance")?.key).toBe("access_log");
  });
});
