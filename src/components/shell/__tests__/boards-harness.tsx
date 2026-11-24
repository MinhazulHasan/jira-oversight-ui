import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { vi } from "vitest";

import { renderKit } from "@/components/ui/__tests__/kit";
import type { Health, ProjectSummary, Projects, Refresh } from "@/lib/api/schemas";
import { BOARD_COOKIE, boardFromCookieHeader } from "@/lib/board";

/** Four minutes before the test runs: a fresh sync, by the reader's own clock. */
export const SYNCED_AT = new Date(Date.now() - 4 * 60_000).toISOString();

export function board(key: string, name: string, synced = true): ProjectSummary {
  return synced
    ? { key, name, issues: 120, last_synced_at: SYNCED_AT, synced: true, type: "software" }
    : { key, name, issues: 0, last_synced_at: null, synced: false, type: "business" };
}

/** Dozens of boards, as a real Jira site has: the default first, the synced ones, then six not synced yet. */
export function manyBoards(): Projects {
  const synced = Array.from({ length: 24 }, (_, index) => board(`TEAM${index + 10}`, `Team ${index + 10} delivery`));
  const waiting = Array.from({ length: 6 }, (_, index) => board(`NEW${index + 10}`, `New programme ${index + 10}`, false));
  return { default: "ALPHA", projects: [board("ALPHA", "Alpha programme"), board("FIN", "Finance systems"), ...synced, ...waiting] };
}

export function healthOf(key: string, lastSyncedAt: string | null = SYNCED_AT): Health {
  return {
    status: "ok",
    message: null,
    data_mode: "live",
    read_only: true,
    api_version: "0.1.0",
    last_synced_at: lastSyncedAt,
    projects: [key],
    report_timezone: "Europe/London",
  };
}

export function idle(project: string): Refresh {
  return { project, state: "idle", started_at: null, finished_at: null, message: null };
}

export interface Service {
  projects: Projects;
  /** Each board's sync as GET /refresh reports it; a POST answers `started` when given, else this. */
  refresh: Record<string, Refresh>;
  started?: Record<string, Refresh>;
  /** A board's health; by default, synced boards are healthy and the others have no sync time. */
  health?: (key: string) => Health | Response;
}

/** The board the request reads: the cookie's pick, else the list's default. */
function picked(service: Service): string {
  return boardFromCookieHeader(document.cookie) ?? service.projects.default;
}

/** Stubs fetch as the route answers; returns the stub, and the service to change mid-test. */
export function serve(service: Service) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input).replace(/^\/api\/oversight\//, "").split("?")[0];
    const key = picked(service);
    if (path === "projects") return Response.json(service.projects);
    if (path === "health") {
      if (service.health) {
        const answer = service.health(key);
        return answer instanceof Response ? answer : Response.json(answer);
      }
      const known = service.projects.projects.find((each) => each.key === key);
      return Response.json(healthOf(key, known?.last_synced_at ?? null));
    }
    if (path === "refresh") {
      if (init?.method === "POST") return Response.json(service.started?.[key] ?? service.refresh[key] ?? idle(key));
      return Response.json(service.refresh[key] ?? idle(key));
    }
    if (path === "overview") return Response.json({ error: "board_not_synced", message: "This board hasn't been synced yet." }, { status: 409 });
    return Response.json({ error: "not_found", message: "Not in this test." }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function pick(key: string | null): void {
  document.cookie = key === null ? `${BOARD_COOKIE}=; path=/; max-age=0` : `${BOARD_COOKIE}=${key}; path=/`;
}

/** The calls made to a path, with their method. */
export function calls(fetchMock: ReturnType<typeof serve>, path: string): { method: string; url: string }[] {
  return fetchMock.mock.calls
    .filter(([input]) => String(input).replace(/^\/api\/oversight\//, "").split("?")[0] === path)
    .map(([input, init]) => ({ method: init?.method ?? "GET", url: String(input) }));
}

export function renderWithQueries(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const view = renderKit(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { ...view, client };
}

/** jsdom lays nothing out: say every element has a box, as a browser would for one on screen. */
export function onScreen(): void {
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(
    () => ({ length: 1, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList,
  );
}
