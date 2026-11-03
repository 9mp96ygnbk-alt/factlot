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

## Submission log: list and directory pull requests (2026-11-03)

All opened from the `9mp96ygnbk-alt` account with `gh`, from forks, on branch `add-factlot`. Status is as last checked on 2026-11-03; nothing had been reviewed yet unless noted. Each description discloses that the maintainer is the submitter and that an agent prepared it.

| Place                                                                                                                                                                      | URL                                                              | Date       | Status                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| punkpeye/awesome-mcp-servers (Real Estate), existing PR, updated: added the cloud marker, hosted endpoint wording, v0.1.1 install line, and a reply to the Glama badge bot | https://github.com/punkpeye/awesome-mcp-servers/pull/18442       | 2026-11-03 | Open; CI passing, labels `has-emoji`, `valid-name`, `has-glama`                                                                                                                                                                          |
| punkpeye/awesome-remote-mcp-servers (Real Estate, 🔓, Glama connector badge `io.github.9mp96ygnbk-alt/factlot`)                                                            | https://github.com/punkpeye/awesome-remote-mcp-servers/pull/3766 | 2026-11-03 | Open; CI passing, labels `endpoint-ok`, `has-connector`. CONTRIBUTING says it is not merged until the account opening the PR has starred that repo; not done (see notes)                                                                 |
| TensorBlock/awesome-mcp-servers (`docs/real-estate--home-services.md`)                                                                                                     | https://github.com/TensorBlock/awesome-mcp-servers/pull/5289     | 2026-11-03 | Open; no checks reported yet                                                                                                                                                                                                             |
| toolsdk-ai/toolsdk-mcp-registry (`packages/finance-fintech/factlot.json`, remote entry `@toolsdk-remote/factlot`)                                                          | https://github.com/toolsdk-ai/toolsdk-mcp-registry/pull/1261     | 2026-11-03 | Open; `biome` and `Package Schema Check` passing. Starring is optional there and was not done                                                                                                                                            |
| Sagargupta16/awesome-mcp-servers (Finance table)                                                                                                                           | https://github.com/Sagargupta16/awesome-mcp-servers/pull/295     | 2026-11-03 | Open; all checks passing; label `missing-star` (the PR self-merges only after the author stars the repo; not done)                                                                                                                       |
| AIAnytime/Awesome-MCP-Servers (`servers/factlot.json`, finance, hosted)                                                                                                    | https://github.com/AIAnytime/Awesome-MCP-Servers/pull/435        | 2026-11-03 | Open; only GitGuardian reported so far. Their README list is generated by `scripts/build.py`; the single line was written by hand to match, so CI lint is the check                                                                      |
| mcpHQ/awesome-mcp-servers (`data/servers.json` plus generated README, llms.txt, llms-full.txt)                                                                             | https://github.com/mcpHQ/awesome-mcp-servers/pull/652            | 2026-11-03 | Open; no checks reported yet. Generated files were reproduced by a separate port of their generator (verified byte-identical on the unmodified catalog), not by running their scripts. mcpHQ reviews PRs on Sunday, Wednesday and Friday |

Notes:

- Existing from before: docker/mcp-registry#6533 and etewiah/awesome-real-estate#120 (not touched in this round). Glama lists the server from the official registry.
- Repository scripts (`npm run validate/generate`, `build.py`, `validate-registry.mjs`) were not executed because they come from third-party repositories. CI on each PR is the first real validation; if one fails, fix the branch `add-factlot` in the fork and say so in the PR.
- Stars: punkpeye/awesome-remote-mcp-servers and Sagargupta16/awesome-mcp-servers merge only after the submitting account stars them. The owner approved, and both were starred on 2026-11-03; Sagargupta16's star check then removed `missing-star` from #295. toolsdk-ai's star is optional and was not added.
- A mistaken commit that added `docs/real-estate--home-services.md` to the awesome-mcp-servers#18442 branch was removed by a follow-up commit; the PR's file list is `README.md` only. The history shows two extra commits.
- Forks of the other lists are named `awesome-mcp-servers-1` (TensorBlock), `-2` (mcpHQ), `-4` (Sagargupta16), `Awesome-MCP-Servers-3` (AIAnytime), plus `awesome-remote-mcp-servers` and `toolsdk-mcp-registry`, under `9mp96ygnbk-alt`.
- Considered and skipped: BlockRunAI/awesome-finance-mcp (crypto and trading focus, last merge 2026-09-05 while newer PRs stayed open); jaw9c/awesome-remote-mcp-servers, wong2/awesome-mcp-servers, chatmcp/mcpso, ever-works/awesome-mcp-servers, wheremind/awesome-hosted-mcp-servers (no merged PRs in 60 days); cline/mcp-marketplace (needs a 400x400 logo, a tested `llms-install.md` run and community-adoption review; the repo's last push was 2025-06); moov-io/awesome-fintech (scope is payments, banking and compliance infrastructure); harxhithc/awesome-proptech and other small proptech lists (1 star or less, no review activity); yzfly/Awesome-MCP-ZH (Chinese-language list). Web-form directories (mcp.so, Smithery, PulseMCP) were out of scope for this round.

## Submission log: Claude Code plugin and skills lists (2026-11-03)

The FactLot Claude Code plugin (marketplace `.claude-plugin/marketplace.json`, plugin `plugins/factlot`, 8 skills). Opened from the `9mp96ygnbk-alt` account with `gh`, from forks, on branch `add-factlot`. Each description discloses that the maintainer submitted it and an agent prepared it. No repository was starred in this round.

| Place                                                                                                                                                                                     | URL                                                          | Date       | Status                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chat2AnyLLM/awesome-repo-configs (`plugin_repos.json` and `skill_repos.json`; feeds the Chat2AnyLLM awesome-claude-plugins and awesome-claude-skills aggregators)                         | https://github.com/Chat2AnyLLM/awesome-repo-configs/pull/316 | 2026-11-03 | Open; their automated review reports "Looks valid", `review-config-pr` passing                                                                                           |
| davepoon/buildwithclaude (external plugin entry in `.claude-plugin/marketplace.json`, category finance, `git-subdir` pinned to factlot commit `6b54878611610b6727a60f962e0ed0301ddfbc01`) | https://github.com/davepoon/buildwithclaude/pull/645         | 2026-11-03 | Open; no checks reported yet. Maintainers have asked other external plugins for pinned installs and untrusted-suggestion handling; ours has no hooks, commands or agents |
| karanb192/awesome-claude-skills (Finance & Tax table, one row linking `plugins/factlot`)                                                                                                  | https://github.com/karanb192/awesome-claude-skills/pull/644  | 2026-11-03 | Open; no checks reported yet                                                                                                                                             |
| BehiSecc/awesome-claude-skills (Data & Analysis section, one line)                                                                                                                        | https://github.com/BehiSecc/awesome-claude-skills/pull/1174  | 2026-11-03 | Open; no checks reported yet                                                                                                                                             |

Notes:

- Forks under `9mp96ygnbk-alt`: `awesome-repo-configs`, `buildwithclaude`, `awesome-claude-skills` (karanb192), `awesome-claude-skills-1` (BehiSecc).
- Third-party scripts (`tests/test_*.py` in awesome-repo-configs, `npm run validate` in buildwithclaude) were not run; the PR bodies say so. Bumping the plugin later means updating the pinned sha in the buildwithclaude entry.
- Skipped because the repo is too new or small: heilcheng/awesome-agent-skills needs at least 20 stars and a repo older than 14 days (FactLot has 0 stars and was created 2026-11-02); JackyST0/awesome-agent-skills needs 256 stars. Those are repository-popularity thresholds, not a requirement that the submitting account star the list. No list in this round required that.
- Skipped, other reasons: hesreallyhim/awesome-claude-code (recommendations only through its web issue form, must be made by a human, `gh` is explicitly not allowed; also wants 14 days of history or 100 stars); VoltAgent/awesome-agent-skills (requires real community usage, brand new skills are not accepted); anthropics/claude-plugins-community and anthropics/claude-plugins-official (submission is the web form at https://clau.de/plugin-directory-submission, PRs are closed automatically; the owner could submit it there); quemsah/awesome-claude-plugins (auto-generated top-100 by stars, no submissions); Chat2AnyLLM/awesome-claude-plugins and awesome-claude-skills (generated from awesome-repo-configs, so covered by #316); composio-community/awesome-claude-plugins, ComposioHQ/awesome-claude-skills, travisvn/awesome-claude-skills, ccplugins/awesome-claude-code-plugins, jqueryscript/awesome-claude-code, libukai/awesome-agent-skills, obra/superpowers-marketplace (no merged PRs in the last 60 days); karanb192/awesome-claude-code-mods and VoltAgent/awesome-claude-code-subagents (different scope: mods and subagents).
