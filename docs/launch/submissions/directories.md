# Directory submissions that need a public repository (or an endpoint, where stated)

> **DRAFT. Nothing has been submitted.** Shared text (name, one-liner, long description, tags, install snippets) is in [`README.md`](README.md). Process URLs were read on 2026-11-03; where a page was behind a login or could not be read, that is stated. All cost $0.

## Glama

- **URL:** [glama.ai/mcp/servers](https://glama.ai/mcp/servers), "Add Server" button (the form itself was not readable without a login).
- **How listings work (from Glama pages and search, read 2026-11-03):** Glama scans public GitHub repositories on a schedule; an author claims a listing by authenticating with GitHub; a repository owned by an organisation needs a `glama.json` file in its root naming maintainers by GitHub username. The awesome-mcp-servers list expects the Glama score badge.
- **Needs:** public repository; a licence file GitHub detects (present).
- **Who acts:** founder, logged in with the GitHub account that owns the repository.
- **Submit:** repository URL `https://github.com/9mp96ygnbk-alt/factlot`; use the shared one-liner and long description wherever the form asks; claim the listing after it appears.
- **Optional `glama.json`** (only if Glama asks; schema URL must be copied from Glama's own instructions, not from here):

```json
{
  "maintainers": ["9mp96ygnbk-alt"]
}
```

## mcp.so

- **URL:** [mcp.so/submit](https://mcp.so/submit) (the "Submit" button in the top navigation). Read: you enter a repository or server URL, the site fetches details, you review the name, description, config and tools, and listings go live after review. Whether a login is required and whether it is free was not stated on the page.
- **Needs:** public repository.
- **Fields to prepare:** name `FactLot`; repository URL; one-liner; long description; install config (the JSON block in [`README.md`](README.md)); tags.

## PulseMCP

- **URL:** [pulsemcp.com/submit](https://pulsemcp.com/submit). On 2026-11-03 the page said PulseMCP was **not accepting new server submissions** and recommended publishing to the official MCP Registry first; it says it picks those up automatically once it reopens.
- **Action:** none manual. Publish to the official registry ([`mcp-registry.md`](mcp-registry.md)) and check back in a week.

## Smithery

- **URL:** [smithery.ai/new](https://smithery.ai/new). From Smithery's docs (found via search, 2026-11-03): enter a **public HTTPS URL** for a Streamable HTTP server and complete the flow; or use the CLI `smithery mcp publish` with the stdio transport, or publish an MCPB bundle for a local server. Smithery is a registry, not a host. The `smithery.ai/docs/build/publish` page returned 404 when fetched directly, so verify the current page.
- **Needs:** a hosted endpoint for the remote path; or a Smithery login and the `factlot.mcpb` bundle for the local path.
- **Who acts:** founder.
- **Day 1 option:** local path with the MCPB bundle from the GitHub release. Remote path after the endpoint exists.

## Cline MCP Marketplace

- **URL:** [github.com/cline/mcp-marketplace](https://github.com/cline/mcp-marketplace), "open an issue using the submission template" (read 2026-11-03).
- **Needs:** public repository URL; a 400x400 PNG logo; a short reason. Test first: give Cline only the README (or an `llms-install.md`) and confirm it can install FactLot. Financial-services servers get extra scrutiny; FactLot does not move money, state that.
- **Issue text:**

```
Title: Add FactLot

Repository: https://github.com/9mp96ygnbk-alt/factlot
Logo: [attach 400x400 PNG]

Reason for addition:
FactLot gives Cline deterministic commercial real estate calculators (rent schedules, net effective rent, CAM reconciliation, loan sizing, ASC 842 remeasurement, WALT, IRR and more) that return every step and a versioned formula ID, plus deterministic IDs for parcels, entities and documents. It runs locally over stdio with no API key and no network calls. Install today is from GitHub (clone, npm install, npm run build, then point at packages/mcp/dist/bin.js); it is not on npm yet. Apache-2.0 and MIT. Read-only tools: none of the tools writes data or moves money. I am the maintainer.
```

## Docker MCP Catalog

- **URL:** [github.com/docker/mcp-registry](https://github.com/docker/mcp-registry), `CONTRIBUTING.md` (read 2026-11-03): fork, `task create -- --category <category> <github-url>` (or `task wizard`), test with Docker Desktop's MCP Toolkit, open a PR. Docker reviews every PR; approved servers appear within 24 hours.
- **Needs:** public repository with a Dockerfile (present) and a permissive licence (Apache-2.0). Go 1.24+, Docker Desktop and Task on the machine that prepares the PR.
- **Open question:** the catalog's local entries run a container as an MCP server over stdio. FactLot's `Dockerfile` starts the HTTP server (`packages/server`). Check the catalog's expectations (and whether a remote-style entry or a stdio entry point is needed) before opening the PR; adding a stdio entry point to the image would be a code change outside this kit.
- **PR title and description:** `Add FactLot (commercial real estate calculators and IDs)`; the long description from [`README.md`](README.md); category: the closest of Finance or Data that the wizard offers.

## Hugging Face

- **URL:** none central. Docs: [huggingface.co/docs/hub/agents-mcp](https://huggingface.co/docs/hub/agents-mcp), Spaces tagged for MCP at [`spaces?filter=mcp-server`](https://huggingface.co/spaces?filter=mcp-server); users add a Space in [settings/mcp](https://huggingface.co/settings/mcp).
- **Needs:** a Hugging Face account and a Gradio Space (free CPU tier) that wraps the calculators as an MCP server. This is a build task, not a form; defer to month 1.
- **Space description (draft):** `Try FactLot's 14 deterministic commercial real estate calculators and IDs as MCP tools. Open source: github.com/9mp96ygnbk-alt/factlot`.

## Not yet researched

Cursor and VS Code directories, the Claude Code plugin marketplace route for local servers ([plugins submission](https://claude.com/docs/plugins/submit.md), linked from Anthropic's guide, not read), and individual client marketplaces. Add them after the first week using each one's own documentation.
