# Changelog

All notable changes to FactLot are recorded here. Every package in this repository (the
`@factlot/*` npm packages and the `factlot` Python package) shares one version number.

The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Calculator formulas carry their own
`version` (for example `calc.net_effective_rent@1`); a formula bump is listed under **Changed**
with the calculator name.

Maintainers: add a line under **Unreleased** in the same pull request as the change. The release
step (`node scripts/release/changelog.mjs release <version>`) moves it under the new version.

## [Unreleased]

The first release. Everything below is the work since the repository was created, summarised
from its commit history; nothing was published to npm or PyPI before it.

### Added

- `@factlot/schema` (MIT): the fact data model with provenance and AI-use rights, exported as
  JSON Schema.
- `@factlot/id`: FactLot ID v0.1, deterministic identifiers for parcels, legal entities,
  documents, and spaces, plus minted building, lease, and loan IDs and short IDs.
- `@factlot/calc`: deterministic calculators with step-by-step audit trails and versioned
  formulas: rent schedule, net effective rent, proposal comparison, CAM reconciliation,
  percentage rent, debt sizing, WALT, NPV, and IRR.
- `@factlot/tools` (MIT): one tool catalog (calculators, IDs, fact validation) generating
  native tool definitions for the Claude Messages API, OpenAI Chat Completions and Responses,
  Gemini, Amazon Bedrock Converse, and OpenAPI 3.1 and 3.0; `runTool` returns input errors as
  data. Every input field carries a description, enforced by a test.
- `@factlot/mcp`: a local stdio MCP server over the whole catalog, with `search` and `fetch`
  over a built-in knowledge base and `schema_get`.
- `@factlot/server`: the remote connector, one stateless HTTP service serving Streamable HTTP
  MCP at `/mcp`, REST at `/v1`, and OpenAPI, with optional bearer auth, and a Docker image.
- A Claude Desktop extension build (`npm run build:mcpb`) that bundles the stdio server and
  generates its manifest from the catalog.
- Connector guides for Claude, ChatGPT and OpenAI, Gemini, Microsoft Copilot Studio, Amazon
  Bedrock (including an Agents action-group Lambda with tests), and OpenAI-compatible clients.
- `factlot` Python package: a dependency-free port of the calculators and IDs that loads the
  generated tool definitions and runs every tool, held to the same conformance vectors as the
  TypeScript packages.
- Language-neutral conformance vectors in `spec/vectors` and a TypeScript-versus-Python
  differential test over random inputs.
- Rules packs: versioned rules that cite their statutes and carry a verification status, with
  the first pack, `rules_tx_property_tax_protest_deadline`, verified against the official
  Texas Tax Code and Government Code text.
- The registry: a Python, SQLite-backed store of cited parcel and entity facts (content-addressed
  snapshots, commercial-only scope, no natural-person indexing, owner-to-entity linking,
  retirement of parcels dropped from a source's latest roll), six `registry_*` tools on every
  surface when a registry is configured, a data policy, and a Texas source catalog.
- A polite data collector (`factlot.collector`) that identifies itself, obeys `robots.txt`
  including `Crawl-delay`, rate-limits per host, reads JSON download listings, names archived
  files from `Content-Disposition`, and records every decision in a manifest; a weekly GitHub
  Actions workflow archives verified Texas sources as release assets.
- Adapters for the Harris CAD and Dallas CAD appraisal rolls and the Texas Comptroller
  franchise-tax entity file, run on the real 2026 files.
- A lease-ingestion prototype (`factlot.ingest`) with deterministic verification of every
  extracted value against a verbatim quote on the cited page, and amendment supersession.
- FactLot Bench: fourteen CRE agent tasks with independently computed ground truth, a runner,
  and a scorer.
- Documentation for agents (`llms.txt`, `AGENTS.md`, `docs/agents.md`), the ID spec, the fact
  model, the registry, rules, ingestion, and the backlog.

### Fixed

- Python validates registry tool input before opening the registry, matching TypeScript (found
  by the shared vectors).
- When two Texas legal holidays fall on the same date, both SDKs keep the first name.
- Collector: skipped URLs are recorded in the manifest, and network failures are no longer
  reported as `robots.txt` refusals.

[Unreleased]: https://github.com/9mp96ygnbk-alt/factlot/commits/main
