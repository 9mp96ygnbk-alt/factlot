# GitHub repository metadata (suggested, not applied)

> **Suggestion only. Nothing has been applied.** Apply after the repository is public (Settings, or the gear icon beside "About" on the repository home page). GitHub's limits, read 2026-11-03 from its [topics documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics): at most 20 topics per repository; each topic is lowercase letters, numbers and hyphens, 50 characters or fewer. The documentation does not state a description length limit; the brief for this kit was under 350 characters.

## Description (279 characters)

```
Open fact layer for commercial real estate AI agents: deterministic calculators with audit trails, canonical IDs, a fact schema with provenance, and cited public-record facts. MCP server, REST/OpenAPI, Python SDK. Works with Claude, ChatGPT, Gemini, Copilot, Bedrock. Apache-2.0.
```

## Website

```
https://factlot.com
```

## Topics (20)

```
mcp
mcp-server
model-context-protocol
ai-agents
llm-tools
function-calling
commercial-real-estate
real-estate
proptech
cre
lease-administration
financial-calculators
underwriting
open-data
provenance
openapi
claude
chatgpt
typescript
python
```

The first three are what MCP directories and Glama look for; the next four are how CRE and proptech people search. Drop `chatgpt` and `claude` first if you want fewer vendor names; do not add topics for tools FactLot does not support.

## Other settings that affect discovery

| Setting                  | Suggested value                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Features, Discussions    | On. Create the welcome post from `posts/github-discussions.md`.                                            |
| Features, Issues         | On (issue templates already exist in `.github/ISSUE_TEMPLATE`).                                            |
| Features, Wiki, Projects | Off, so there is one place for documentation (the repository).                                             |
| Social preview image     | Upload a 1280x640 image with the name and tagline. Not produced by this kit.                               |
| Releases                 | Cut `v0.1.0` with `factlot.mcpb` attached; the MCP Registry MCPB route needs it.                           |
| Pinned discussion        | The welcome post.                                                                                          |
| `good first issue`       | Label three small items from `docs/BACKLOG.md`.                                                            |
| Licence                  | Apache-2.0 is detected from `LICENSE` at the root; Glama and the Docker catalog want a detectable licence. |
