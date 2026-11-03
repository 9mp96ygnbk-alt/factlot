# awesome-mcp-servers

> **DRAFT. Nothing has been submitted.** Repository: [`punkpeye/awesome-mcp-servers`](https://github.com/punkpeye/awesome-mcp-servers). Rules read 2026-11-03 from its [CONTRIBUTING.md](https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md) and README.

## Rules that apply (from CONTRIBUTING.md, paraphrased)

- Only servers with a public GitHub repository that you install and run yourself belong here. Remote-only servers go to a separate list (`awesome-remote-mcp-servers`). FactLot's local MCP server qualifies.
- Fork, branch, edit `README.md` following the existing format, commit, push, open a pull request with a clear title and description, then wait for review.
- One server per line, linked name, brief description, in the relevant category; keep servers alphabetical within a category.
- Match formatting, check links, keep descriptions concise and accurate.
- Agents may append `🤖🤖🤖` to the end of the PR title to opt in to fast-track merging. Use it only if an agent, not the founder, opens the PR, and say so in the description.
- Every entry in the current README carries a Glama score badge, and the README notes a web directory on Glama synced with the repository. So list FactLot on Glama first and confirm the badge URL resolves.

## Category

**Real Estate** (anchor `#real-estate`, heading "MCP servers for real estate CRM, property management, and agent workflows."). Do not add a new category.

Legend for the icons: 📇 TypeScript/JavaScript codebase, 🏠 local service, and an operating system icon only for systems you have tested. FactLot's server was run on macOS for this kit; add 🍎 only if you want to claim it, and add 🪟 or 🐧 only after testing there.

## Entry line

Place it in the Real Estate section in alphabetical position (a name beginning with a digit sorts first).

```markdown
- [9mp96ygnbk-alt/factlot](https://github.com/9mp96ygnbk-alt/factlot) [![9mp96ygnbk-alt/factlot MCP server](https://glama.ai/mcp/servers/9mp96ygnbk-alt/factlot/badges/score.svg)](https://glama.ai/mcp/servers/9mp96ygnbk-alt/factlot) 📇 🏠 - Commercial real estate calculators (rent, NER, CAM, loan sizing, ASC 842, WALT, IRR) that return audit trails and formula IDs, plus parcel and entity IDs and fact validation. No API key.
```

(The Glama URL slug is the pattern other entries use; confirm it against the real Glama page once the listing exists.)

## PR title

```
Add FactLot (Real Estate)
```

If an agent opens the PR: `Add FactLot (Real Estate) 🤖🤖🤖`.

## PR description

```
Adds FactLot to the Real Estate section.

FactLot is an open-source MCP server for commercial real estate AI agents: 14 deterministic calculators that return the value, every step, warnings and a versioned formula ID, deterministic IDs for parcels, entities, spaces and documents, and fact validation. It runs locally over stdio with no API key and no network calls.

- Repository: https://github.com/9mp96ygnbk-alt/factlot (public, Apache-2.0 and MIT)
- Installs and runs locally; it is not remote-only.
- Local install today is from GitHub (clone, `npm install`, `npm run build`). It is not on npm or PyPI yet.
- Glama listing: https://glama.ai/mcp/servers/9mp96ygnbk-alt/factlot

Checks:
- [x] One line, in the Real Estate category, in alphabetical position
- [x] Links tested
- [x] Glama badge resolves
- [x] Description says what the server does and nothing it cannot do

I am the maintainer. [If an agent prepared or opened this PR, say so here: "This pull request was prepared by an AI agent on the maintainer's behalf."]
```

## Similar lists (same approach, check each list's own rules first)

Other lists exist for MCP servers and for agent tools; none was read for this kit. Before submitting to any, read its CONTRIBUTING file, follow its format exactly, and disclose that you are the maintainer. Search GitHub for `awesome-mcp`, `awesome-ai-agents`, and `awesome-proptech` and treat each result as unverified until read.
