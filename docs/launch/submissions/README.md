# Submission text

> **DRAFT. Nothing here has been submitted.** Each file holds the exact text for one place, with the process URL and the date it was read (2026-11-03). Use the shared blocks below so every listing says the same true things, and re-read each directory's current rules before submitting: several are in preview or have changed recently.

| File                                                 | Places                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [`mcp-registry.md`](mcp-registry.md)                 | Official MCP Registry (`server.json`, commands, what must exist first)                                    |
| [`awesome-mcp-servers.md`](awesome-mcp-servers.md)   | `punkpeye/awesome-mcp-servers`: the entry line, PR title and PR description                               |
| [`directories.md`](directories.md)                   | Glama, mcp.so, PulseMCP, Smithery, Cline marketplace, Docker MCP Catalog, Hugging Face                    |
| [`platform-directories.md`](platform-directories.md) | Anthropic Connectors Directory, ChatGPT apps directory, Microsoft Copilot Studio (need a hosted endpoint) |
| [`frameworks.md`](frameworks.md)                     | Vercel AI SDK, LangChain, LlamaIndex, CrewAI, OpenAI Agents SDK                                           |

## Shared blocks

### Name

```
FactLot
```

### One-line description (94 characters)

```
Deterministic CRE calculators with audit trails, canonical IDs, and cited facts for AI agents.
```

Shorter form (91 characters), for fields that are tighter:

```
Audited commercial real estate math, stable IDs, and cited facts for AI agents. No API key.
```

### Long description

```
FactLot is an open fact layer for commercial real estate (CRE) AI agents. It gives an agent tools to call instead of doing lease math or guessing identifiers in context.

Fourteen deterministic calculators cover rent schedules, net effective rent, proposal comparison, percentage rent, CAM reconciliation, debt sizing, ASC 842 lease remeasurement, prepayment and defeasance, WALT, NPV, IRR, lease vs. own, renew vs. relocate, and hotel metrics. Every result returns its value, every intermediate step, warnings that need a human, and a versioned formula ID such as calc.cam_reconciliation@1.

FactLot IDs are deterministic identifiers for parcels, legal entities, spaces and documents that any agent can compute offline, so two systems that mean the same parcel produce the same key. A fact schema records each claim with its provenance (document, page, clause, method) and its AI-use rights, and a validator rejects uncited facts. One rules pack is verified: the Texas property tax protest deadline, checked against the statute.

The local MCP server runs over stdio, needs no API key, and makes no network calls. The same tools are also served over REST and OpenAPI, and as native function definitions for Claude, OpenAI, Gemini, Bedrock and Mistral. The TypeScript and Python implementations pass the same test vectors.

Status: open source (Apache-2.0 and MIT), installed from GitHub today; not yet on npm or PyPI; no hosted public endpoint. A registry of cited public-record parcel and entity facts (708,538 commercial parcels and 12.9 million registered entities from 18 verified sources) exists but is not queryable publicly yet. Lease ingestion is a prototype.
```

(About 1,600 characters.)

### Categories and tags

Categories: Real Estate; Finance; Developer Tools; Data.

Tags: `commercial-real-estate`, `cre`, `real-estate`, `mcp`, `mcp-server`, `calculators`, `lease`, `underwriting`, `finance`, `ai-agents`, `open-data`, `provenance`.

### Install snippets that work today

Requires Node.js 22.6 or newer. Local MCP server from a source build (Claude Code):

```bash
git clone https://github.com/9mp96ygnbk-alt/factlot.git && cd factlot
npm install && npm run build
claude mcp add factlot -- node "$PWD/packages/mcp/dist/bin.js"
```

Any MCP client config (replace the path):

```json
{
  "mcpServers": {
    "factlot": {
      "command": "node",
      "args": ["/absolute/path/to/factlot/packages/mcp/dist/bin.js"]
    }
  }
}
```

Docker (REST, OpenAPI and remote MCP on port 8787):

```bash
docker build -t factlot . && docker run --rm -p 8787:8787 factlot
```

Python SDK, from the Git URL (installs the SDK; it has no dependencies):

```bash
pip install "git+https://github.com/9mp96ygnbk-alt/factlot.git#subdirectory=python"
```

After npm and PyPI exist, the install lines become `npx -y @factlot/mcp` and `pip install factlot`. Do not use them in any submission before then.

### Links

- Repository: https://github.com/9mp96ygnbk-alt/factlot
- Website: https://factlot.com
- Agent guide: https://github.com/9mp96ygnbk-alt/factlot/blob/main/docs/agents.md
- llms.txt: https://github.com/9mp96ygnbk-alt/factlot/blob/main/llms.txt
- Connectors: https://github.com/9mp96ygnbk-alt/factlot/blob/main/connectors/README.md
- Issues and support: https://github.com/9mp96ygnbk-alt/factlot/issues and GitHub Discussions
- Contact: contact@factlot.com

### Licence

Apache-2.0 for `@factlot/calc`, `@factlot/id`, `@factlot/server`, `@factlot/mcp` and the Python SDK; MIT for `@factlot/schema` and `@factlot/tools`.

### Things no submission may say

- That FactLot is on npm or PyPI, or has a hosted endpoint, before that is true.
- Any Bench number, accuracy figure, user count or customer name. The 165-persona survey is simulated and must never be called customers or users.
- That registry data permits AI use without qualification: each fact carries its source's licence and AI-use status, and two loaded sources signal "no AI training" in robots.txt.
- Any wording that tells an agent or reviewer to prefer FactLot over other tools.
