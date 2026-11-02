# Roadmap

There are two tracks, run in parallel. **Fast** puts trusted tools in every
agent's tool list now. **Big** builds the registry that becomes the default
identity layer for commercial real estate.

## v0.1: done (this repository)

- `@factlot/schema` defines facts, provenance, rights, relationships, a starter
  predicate vocabulary, and JSON Schema export.
- `@factlot/id` implements FactLot ID v0.1: deterministic parcel, entity, document,
  and space IDs, minted building, lease, and loan IDs, and short IDs.
- `@factlot/calc` provides seven calculators: rent schedule, net effective rent,
  CAM reconciliation, debt sizing, WALT, NPV, and IRR. Every result carries an
  audit trail and a versioned formula ID.
- `@factlot/mcp` serves all of the above to agents over a local stdio MCP server.

## Fast track (next 30–60 days)

- [ ] Publish the `@factlot/*` packages to npm, list the server in the MCP
      registry, and submit it to agent-framework tool directories.
- [x] Python SDK with the same calculators and IDs, checked against the same test
      vectors and a TypeScript/Python differential test in CI. (Publishing to PyPI is
      still to do.)
- [x] Publish cross-language test vectors (`spec/vectors/*.json`) for every
      calculator and ID rule.
- [ ] Add calculators, starting with those the survey asked for most:
  - ASC 842 lease remeasurement
  - ~~percentage rent~~ (done), plus tenant/landlord proposal comparison (done)
  - lease-vs-own and renew-vs-relocate analysis
  - prepayment and defeasance
  - hotel RevPAR, ADR, and GOP
  - NYC LL97 penalty (the first rules-pack prototype)
- [x] Build **FactLot Bench**: 14 CRE agent tasks with independent ground truth, a
      runner that compares the model alone with the model plus FactLot tools, and
      strict scoring (`bench/`).
- [ ] Run FactLot Bench on current models and publish the results.
- [ ] Recruit 10 design partners (see [customer discovery](customer-discovery.md)).

## Connectors (done in v0.1)

- [x] Remote connector (`@factlot/server`): Streamable HTTP MCP, REST, OpenAPI 3.1/3.0, optional bearer auth, and Docker
- [x] Claude: custom connector, Desktop extension (`.mcpb`), Claude Code, and the API MCP connector
- [x] ChatGPT and OpenAI: developer-mode app, deep research (`search`/`fetch`), Custom GPT Action, Responses API remote MCP, and function calling
- [x] Gemini, Microsoft Copilot (Copilot Studio MCP and a Swagger connector), Amazon Bedrock (Converse and an Agents Lambda), and OpenAI-compatible providers
- [ ] Deploy a public endpoint (for example `mcp.factlot.com`) and connect it live in each platform's console
- [ ] Submit to directories: the Anthropic connector directory, ChatGPT apps, the MCP registry, and Copilot/AppSource

## Big track (registry)

Decisions (2026-11-02): $0 data budget, public sources only, obtained ethically and legally; hybrid model; Texas first. See [docs/registry](registry/README.md).

- [x] Data policy and Texas source catalog
- [x] Registry core: cited facts, coverage-based currency, commercial-only scope, privacy rules, owner resolution, search (`factlot.registry`)
- [ ] Texas adapters (Harris → Dallas → Comptroller entities → Travis/Tarrant/Bexar). **Blocked:** source domains must be allowed in the environment's network settings

- [ ] **Registry alpha.** Ingest assessor and recorder data for the top 25 US
      counties by commercial property value, and resolve parcel to owner of record
      to entity. Entity data comes from Secretary of State filings, starting with
      DE, NY, CA, TX, and FL.
- [ ] Hosted API: `resolve`, `get`, `crosswalk`, and `lineage`, plus change webhooks.
      Add MCP tools for registry lookups, which are opt-in and need an API key.
- [ ] Crosswalks to common keys: NYC BBL/BIN, DOE UBID, LEI, CMBS loan IDs, and
      customer-supplied Yardi and MRI codes.
- [ ] Build out the beneficial-ownership graph: managing members, sponsors,
      lenders, and loan maturities, every edge cited to a recorded document.
- [ ] Expand to 100 counties, then nationwide.

## Then

- **Ingest.** Leases, amendments, rent rolls, T-12s, OMs, and estoppels become cited
  facts, with amendment-aware supersession. Ingest will be self-hostable.
- **Rules packs.** Property tax (TX, NY, IL, CA first), building-performance
  standards (LL97, BERDO, and others), and zoning envelopes for the top 20 metros.
- **Write-backs.** Push critical dates, CAM statements, and estoppels into Yardi,
  MRI, and VTS, always behind human approval. These were the only action tools the
  survey asked for.
- **Rights clearinghouse.** A marketplace for facts licensed for AI use.

## Not planned

Agent-to-agent negotiation, contact databases, and foot-traffic data. These were
the lowest-scoring offerings in the survey, and the last two are better served by
existing vendors.
