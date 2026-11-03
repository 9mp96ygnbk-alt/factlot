# FactLot remote connector: Streamable HTTP MCP (/mcp), REST (/v1), OpenAPI (/openapi.json).
#   docker build -t factlot .
#   docker run --rm -p 8787:8787 --read-only --cap-drop ALL --security-opt no-new-privileges \
#     -e FACTLOT_API_KEY=... -e FACTLOT_PUBLIC_URL=https://factlot.example.com factlot
# Without a key the server is open to anyone who can reach the port (see packages/server/README.md).
#
# The base image is pinned by digest (multi-arch index); Dependabot proposes updates. Override with
# --build-arg NODE_IMAGE=... only to point at a mirror of the same image.
ARG NODE_IMAGE=node:22-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
# --ignore-scripts: no dependency install scripts run; then drop dev dependencies and sources the
# runtime does not need.
RUN npm ci --ignore-scripts \
  && npm run build --workspaces \
  && npm prune --omit=dev \
  && find packages -name '*.test.ts' -delete \
  && find node_modules -type d -empty -delete

FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
# Owned by root and read-only to the runtime user: the process cannot modify its own code.
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
# The image's unprivileged user (uid 1000). The server writes nothing to disk unless
# FACTLOT_USAGE_LOG is set, so it runs with --read-only; mount a volume for that file if used.
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
STOPSIGNAL SIGTERM
CMD ["node", "packages/server/dist/bin.js"]
