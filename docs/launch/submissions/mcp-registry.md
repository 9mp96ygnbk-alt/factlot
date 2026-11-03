# Official MCP Registry

> **DRAFT. Nothing has been published.** Process read 2026-11-03: [quickstart](https://modelcontextprotocol.io/registry/quickstart), [package types](https://modelcontextprotocol.io/registry/package-types), [authentication](https://modelcontextprotocol.io/registry/authentication), [GitHub Actions](https://modelcontextprotocol.io/registry/github-actions). The registry is in preview and may change; it stores metadata only and verifies that you control the package.

## What must exist first

The registry does not take a bare repository URL. It needs one of:

| Route                            | What must exist                                                                                                                             | Account needed        | Ready today?                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| **MCPB (recommended for day 1)** | A public GitHub release with `factlot.mcpb` attached. The URL must contain "mcp" (it does) and `server.json` must carry the file's SHA-256. | GitHub only           | Yes, after the repo is public and the release is cut. Build with `npm run build:mcpb`.     |
| npm                              | `@factlot/mcp` published on npm, with `"mcpName": "io.github.9mp96ygnbk-alt/factlot"` in its `package.json`.                                | npm org (backlog A5)  | No. `mcpName` is a code change to `packages/mcp/package.json` that this kit does not make. |
| PyPI                             | Not applicable: the Python package is the SDK, not an MCP server.                                                                           |                       |                                                                                            |
| OCI image                        | An image on `ghcr.io` or Docker Hub with the label `io.modelcontextprotocol.server.name`.                                                   | GitHub only (ghcr.io) | Not recommended: the current image starts the HTTP server, not the stdio server.           |
| Remote URL                       | A hosted HTTPS endpoint (see the [remote servers page](https://modelcontextprotocol.io/registry/remote-servers.md), not read for this kit). | Host (backlog A4)     | No.                                                                                        |

## Choosing the name (permanent in practice, so decide before publishing)

- **GitHub login:** `io.github.9mp96ygnbk-alt/factlot`. Works today with `mcp-publisher login github`. The name carries the personal account name.
- **DNS proof:** `com.factlot/factlot`. Needs a TXT record on `factlot.com` containing `v=MCPv1; k=ed25519; p=<public key>` and `mcp-publisher login dns --domain factlot.com --private-key ...` (full commands on the authentication page). Costs $0 and gives a cleaner name that matches the brand. Choose this if the founder controls factlot.com DNS today.

## `server.json` (MCPB route)

Fill `<VERSION>` and `<SHA256>` from the release. Compute the hash with `openssl dgst -sha256 dist/factlot.mcpb`.

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.9mp96ygnbk-alt/factlot",
  "title": "FactLot",
  "description": "Deterministic CRE calculators with audit trails, canonical IDs, and cited facts for AI agents.",
  "repository": {
    "url": "https://github.com/9mp96ygnbk-alt/factlot",
    "source": "github"
  },
  "websiteUrl": "https://factlot.com",
  "version": "<VERSION>",
  "packages": [
    {
      "registryType": "mcpb",
      "identifier": "https://github.com/9mp96ygnbk-alt/factlot/releases/download/v<VERSION>/factlot.mcpb",
      "fileSha256": "<SHA256>",
      "transport": { "type": "stdio" }
    }
  ]
}
```

## `server.json` (npm route, after the package exists)

Add `"mcpName": "io.github.9mp96ygnbk-alt/factlot"` to `packages/mcp/package.json` first.

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.9mp96ygnbk-alt/factlot",
  "title": "FactLot",
  "description": "Deterministic CRE calculators with audit trails, canonical IDs, and cited facts for AI agents.",
  "repository": {
    "url": "https://github.com/9mp96ygnbk-alt/factlot",
    "source": "github",
    "subfolder": "packages/mcp"
  },
  "websiteUrl": "https://factlot.com",
  "version": "<VERSION>",
  "packages": [
    {
      "registryType": "npm",
      "identifier": "@factlot/mcp",
      "version": "<VERSION>",
      "transport": { "type": "stdio" }
    }
  ]
}
```

(`subfolder` is in the registry's schema for monorepos; confirm against the schema URL before use.)

## Commands

```bash
brew install mcp-publisher          # or the release tarball on the quickstart page
mcp-publisher login github          # device flow at https://github.com/login/device
mcp-publisher publish               # run in the directory that holds server.json
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.9mp96ygnbk-alt/factlot"
```

A GitHub Actions workflow with OIDC login (`mcp-publisher login github-oidc`) can republish on every `v*` tag; the release workflow is owned elsewhere, so propose the job to its owner rather than editing it from this kit.

## What follows

PulseMCP states that it picks up servers published to the official registry automatically once its submissions reopen ([pulsemcp.com/submit](https://pulsemcp.com/submit), read 2026-11-03: it was not accepting submissions that day). Other directories and clients sync from the registry or from GitHub; check each a week later and use `directories.md` for the ones that need a manual step.
