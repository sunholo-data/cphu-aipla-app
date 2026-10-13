# sim-verify — headless Chromium that runs a sim draft (in-app-sim-authoring M3).
# Build from the assembled context: scripts/assemble-sim-verify.sh <dir>.
# The Playwright image carries the browsers for exactly this Playwright version.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 NODE_ENV=production APP_ROOT=/app
WORKDIR /app
RUN npm init -y >/dev/null && npm install --no-audit --no-fund playwright@1.63.0 \
 && mkdir -p infrastructure/mcp-sandbox \
 && cd infrastructure/mcp-sandbox && npm init -y >/dev/null && npm install --no-audit --no-fund three@0.128.0

# The repo files verify_sim.mjs reads, at their repo paths (it resolves its root
# from its own location): the script, the bridge stamper, the bridge, the vendor
# manifest and the non-npm vendored files.
COPY ctx/ /app/
COPY server.mjs /app/server.mjs

USER pwuser
EXPOSE 8080
CMD ["node", "/app/server.mjs"]
