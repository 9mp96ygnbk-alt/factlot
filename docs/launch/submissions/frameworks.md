# Agent framework listings

> **DRAFT. Nothing has been submitted.** FactLot works with every framework below through MCP or plain function calling, so no framework-specific code is needed; what a listing adds is being findable. Process notes were read on 2026-11-03; items marked "not confirmed" must be checked before any PR. All snippets below must be run once before they are posted: this kit did not execute them.

## Vercel AI SDK tools registry

- **Process:** [ai-sdk.dev/tools-registry](https://ai-sdk.dev/tools-registry) says to package your functionality (starter template `vercel-labs/ai-sdk-tool-as-package-template`) and submit by adding an entry to `content/tools-registry/registry.ts` in the `vercel/ai` repository. Entry fields and review criteria were not read.
- **Needs:** an npm package (backlog A5), so this waits for the first npm publish.
- **Entry draft:** name `FactLot`; description the 94-character one-liner; package `@factlot/tools`; docs link the `connectors/others/README.md` page; install `npm install @factlot/tools` (only after publishing).

## LangChain

- **Process:** [docs.langchain.com contributing guide](https://docs.langchain.com/oss/python/contributing/integrations) (found via search): new integrations are not accepted as PRs to langchain-ai repositories; publish an independent PyPI package, then file the integration listing issue. An older page describing a monorepo PR route conflicts: not confirmed which applies.
- **Needs:** a PyPI package. The existing `factlot` SDK provides tool definitions and `run_tool`; a thin `langchain-factlot` package would wrap them as LangChain tools. That is new code and out of scope here.
- **Interim:** a docs page in `connectors/others/README.md` showing the MCP adapter route: LangChain's MCP adapters load tools from any MCP server, so point one at `node packages/mcp/dist/bin.js`. Confirm the adapter package name against LangChain's docs and run it before publishing.

## LlamaIndex

- **Process:** the MCP integration is [`llama-index-tools-mcp`](https://pypi.org/project/llama-index-tools-mcp/) (a tool spec that loads tools from an MCP server). The route for listing a new tool package was not confirmed.
- **Interim:** a how-to page using `McpToolSpec` against the stdio server. Run it first.

## CrewAI

- **Process:** no contribution route was found. CrewAI can load MCP tools through its MCP adapter. Check CrewAI's current documentation before writing a page.

## OpenAI Agents SDK

- **Process:** no registry. The SDK accepts MCP servers directly. Add a short example to `connectors/chatgpt/README.md` once it has been run against the local server.

## Message to a framework maintainer (only if a maintainer asks for a pitch)

```
FactLot is an open-source set of tools for commercial real estate agents: 14 deterministic calculators that return steps and a versioned formula ID, deterministic IDs for parcels, entities and documents, and fact validation. It runs as a local MCP server with no API key. I would like to add a short docs page showing it used with [framework]. Repository: https://github.com/9mp96ygnbk-alt/factlot. I am the maintainer; it is not on npm or PyPI yet and installs from GitHub.
```

Do not send it unprompted to individuals.
