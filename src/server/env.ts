import "server-only";

/**
 * The interface's server-side configuration. Read on every request rather
 * than once at start-up, so a misconfiguration is reported where it bites (in
 * the response that needed the value) and tests can switch modes freely.
 *
 * None of these variables may carry a NEXT_PUBLIC_ prefix: that would inline
 * them into the browser bundle. Errors name a variable, never its value.
 */

export type DataMode = "sample" | "live";

export interface LiveConfig {
  /** The oversight dashboard API, always with a trailing slash so paths resolve under it. */
  apiUrl: URL;
  serviceKey: string;
  /** The Jira site, for "Open in Jira" links; null when not configured. */
  jiraBaseUrl: URL | null;
}

export interface SampleConfig {
  /** Pinned "now" (epoch ms), or null to anchor on the server's own clock. */
  now: number | null;
  /** Simulated response delays, in milliseconds. */
  latency: { read: number; ask: number };
  /**
   * Whether people may be compared side by side (the everyone table, several
   * people's scorecards), as the service's PEOPLE_COMPARISON decides it there:
   * on unless an organisation turns it off. SAMPLE_PEOPLE_COMPARISON, read on
   * every request like the rest.
   */
  peopleComparison: PeopleComparison;
}

/** PEOPLE_COMPARISON on the service, SAMPLE_PEOPLE_COMPARISON in the sample: on by default. */
export type PeopleComparison = "on" | "off";

export type ServerConfig =
  | { mode: "sample"; sample: SampleConfig }
  | { mode: "live"; live: LiveConfig };

/** The configuration cannot serve a request. The message is safe to show. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Reads, the default; Ask waits on two or three model calls, so it is slower on purpose. */
const DEFAULT_SAMPLE_LATENCY = { read: 250, ask: 900 } as const;
const MAX_LATENCY_MS = 10_000;

type Env = Readonly<Record<string, string | undefined>>;

function value(env: Env, name: string): string {
  return (env[name] ?? "").trim();
}

function httpUrl(raw: string, name: string, protocols: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${name} is not a URL.`);
  }
  if (!protocols.includes(url.protocol)) {
    throw new ConfigError(`${name} must start with ${protocols.map((p) => `${p}//`).join(" or ")}.`);
  }
  if (url.username || url.password) {
    // Credentials in a URL end up in logs; the key travels in its own header.
    throw new ConfigError(`${name} must not carry a user name or password.`);
  }
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function sampleNow(env: Env): number | null {
  const raw = value(env, "SAMPLE_NOW");
  if (!raw) return null;
  // ISO 8601 with a zone only: a zoneless time would be read in the server's own zone.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    throw new ConfigError("SAMPLE_NOW must be an ISO 8601 time with a zone, for example 2026-11-04T14:30:00Z.");
  }
  const time = Date.parse(raw);
  if (Number.isNaN(time)) throw new ConfigError("SAMPLE_NOW is not a valid time.");
  return time;
}

const LATENCY_FORMAT = 'SAMPLE_LATENCY must be milliseconds ("250"), or reads and Ask apart ("250,900").';

function latencyPart(raw: string): number {
  if (!/^\d{1,5}$/.test(raw)) throw new ConfigError(LATENCY_FORMAT);
  return Math.min(Number(raw), MAX_LATENCY_MS);
}

/** Empty: the defaults. One number: reads and Ask alike (0 turns the delay off). Two: reads, then Ask. */
function sampleLatency(env: Env): SampleConfig["latency"] {
  const raw = value(env, "SAMPLE_LATENCY");
  if (!raw) return { ...DEFAULT_SAMPLE_LATENCY };
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.length > 2) throw new ConfigError(LATENCY_FORMAT);
  const read = latencyPart(parts[0]);
  return { read, ask: parts.length === 2 ? latencyPart(parts[1]) : read };
}

/** Empty: on. Otherwise "on" or "off" in any case; anything else is a mistake to report, never a guess. */
function peopleComparison(env: Env): PeopleComparison {
  const raw = value(env, "SAMPLE_PEOPLE_COMPARISON").toLowerCase();
  if (!raw || raw === "on") return "on";
  if (raw === "off") return "off";
  throw new ConfigError('SAMPLE_PEOPLE_COMPARISON must be "on" or "off".');
}

export function readConfig(env: Env = process.env): ServerConfig {
  const mode = value(env, "OVERSIGHT_DATA").toLowerCase() || "sample";

  if (mode === "sample") {
    return { mode, sample: { now: sampleNow(env), latency: sampleLatency(env), peopleComparison: peopleComparison(env) } };
  }
  if (mode !== "live") {
    throw new ConfigError('OVERSIGHT_DATA must be "sample" or "live".');
  }

  const apiUrl = value(env, "OVERSIGHT_API_URL");
  if (!apiUrl) throw new ConfigError("OVERSIGHT_API_URL is not set, so live data has nowhere to come from.");
  const serviceKey = value(env, "OVERSIGHT_SERVICE_KEY");
  if (!serviceKey) {
    throw new ConfigError("OVERSIGHT_SERVICE_KEY is not set, so no request to the oversight service can be authenticated.");
  }
  const jira = value(env, "OVERSIGHT_JIRA_BASE_URL");

  return {
    mode,
    live: {
      apiUrl: httpUrl(apiUrl, "OVERSIGHT_API_URL", ["http:", "https:"]),
      serviceKey,
      jiraBaseUrl: jira ? httpUrl(jira, "OVERSIGHT_JIRA_BASE_URL", ["https:"]) : null,
    },
  };
}
