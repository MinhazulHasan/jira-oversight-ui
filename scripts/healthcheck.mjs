import http from "node:http";
import https from "node:https";
import { pathToFileURL } from "node:url";

const TIMEOUT_MS = 4000;
const MAX_BODY = 64 * 1024;

/** GET `url` with `headers`: {status, body}; status 0 when it could not be asked or did not answer in time. */
export function get(url, headers = {}) {
  return new Promise((resolve) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.get(url, { headers, agent: false, timeout: TIMEOUT_MS }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        if (body.length < MAX_BODY) body += chunk;
      });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      response.on("error", () => resolve({ status: 0, body: "" }));
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve({ status: 0, body: "" }));
  });
}

/** Whether the dashboard is healthy (see the top of this file), asking with `ask` (`get` in the container). */
export async function healthy(env, ask = get) {
  const own = await ask(new URL(`http://127.0.0.1:${env.PORT || "3400"}/api/oversight/health`));
  if (own.status !== 200 && own.status !== 401) return false;
  if (env.OVERSIGHT_DATA === "sample") return true;
  const base = env.OVERSIGHT_API_URL ?? "";
  const key = env.OVERSIGHT_SERVICE_KEY ?? "";
  if (!base || !key) return false;
  let url;
  try {
    url = new URL("api/v1/health", base.endsWith("/") ? base : `${base}/`);
  } catch {
    return false;
  }
  const api = await ask(url, { accept: "application/json", "x-service-key": key });
  if (api.status !== 200) return false;
  try {
    const status = JSON.parse(api.body)?.status;
    return status === "ok" || status === "degraded";
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  healthy(process.env).then(
    (ok) => {
      process.exitCode = ok ? 0 : 1;
    },
    () => {
      process.exitCode = 1;
    },
  );
}
