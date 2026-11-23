#
# The Jira Oversight dashboard, as a self-contained Next.js server (output: standalone). The oversight service's
# deploy/docker-compose.yml builds and runs it beside the API; its docs/DEPLOYMENT.md says how.
#
# Nothing is baked in: every setting in .env.example is read on the server at run time, from the environment the
# compose file gives it (env_file). The build context is an allowlist (.dockerignore): no .env file, no
# node_modules, no .next and no test output ever reaches it. The base image is the only pull: Docker's built-in
# Dockerfile frontend reads this file, so no syntax image is fetched either.

ARG NODE_IMAGE=node:24-bookworm-slim

# --- dependencies: exactly package-lock.json, with no install script run ------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

# --- build ----------------------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    STANDALONE_OUTPUT=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public && npm run build

# --- run: the traced server only, as the unprivileged node user ---------------------------------------------------------
FROM ${NODE_IMAGE} AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3400 \
    HOSTNAME=0.0.0.0
# The code belongs to root and is only readable by the user the server runs as, so a compromised process cannot
# rewrite it (a restart keeps the container's writable layer). Only Next.js's cache folder is the server's to write.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/scripts/healthcheck.mjs ./healthcheck.mjs
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 3400
# Healthy only when this server answers its health route (200 with sign-in off, 401 with sign-in on: the gate
# answering a request without a session; 500 means sign-in is on but not configured) and the API answers its own
# health route to this server's settings (OVERSIGHT_API_URL with OVERSIGHT_SERVICE_KEY: 200, ok or degraded). So a
# stopped or unreachable API, or a service key that does not match the API's, shows the dashboard unhealthy:
# scripts/healthcheck.mjs.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD ["node", "healthcheck.mjs"]
CMD ["node", "server.js"]
