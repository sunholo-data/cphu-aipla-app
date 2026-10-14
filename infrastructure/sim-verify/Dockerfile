# sim-verify — headless Chromium that runs a sim draft (in-app-sim-authoring M3).
# Build from the assembled context: scripts/assemble-sim-verify.sh <dir>.
# The Playwright image carries the browsers for exactly this Playwright version.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 NODE_ENV=production APP_ROOT=/app
WORKDIR /app
RUN npm init -y >/dev/null && npm install --no-audit --no-fund playwright@1.63.0

# The vendored npm libraries (three, uplot, matter-js, …) from the SANDBOX's own
# lockfile, so the checker serves byte-identical files to the sandbox and a new
# library cannot pass in one and 404 in the other (2026-10-14: this used to be a
# hand-pinned `npm install three@0.128.0`).
COPY ctx/infrastructure/mcp-sandbox/package.json ctx/infrastructure/mcp-sandbox/package-lock.json /app/infrastructure/mcp-sandbox/
RUN cd infrastructure/mcp-sandbox && npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# The repo files verify_sim.mjs reads, at their repo paths (it resolves its root
# from its own location): the script, the bridge stamper, the bridge, the vendor
# manifest and the non-npm vendored files.
COPY ctx/ /app/
COPY server.mjs /app/server.mjs

USER pwuser
EXPOSE 8080
CMD ["node", "/app/server.mjs"]
