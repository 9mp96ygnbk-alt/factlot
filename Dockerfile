# FactLot remote connector: Streamable HTTP MCP (/mcp), REST (/v1), OpenAPI (/openapi.json).
# docker build -t factlot . && docker run -p 8787:8787 factlot
ARG NODE_IMAGE=node:22-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
RUN npm ci --ignore-scripts && npm run build --workspaces && npm prune --omit=dev

FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/server/dist/bin.js"]
