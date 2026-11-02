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
- [ ] Release a Python SDK (`factlot` on PyPI) with the same calculators and IDs,
      checked against the same test vectors.
- [ ] Publish cross-language test vectors (`spec/vectors/*.json`) for every
      calculator and ID rule.
- [ ] Add calculators, starting with those the survey asked for most:
  - ASC 842 lease remeasurement
  - percentage rent
  - lease-vs-own and renew-vs-relocate analysis
  - prepayment and defeasance
  - hotel RevPAR, ADR, and GOP
  - NYC LL97 penalty (the first rules-pack prototype)
- [ ] Build **FactLot Bench**: an evaluation harness of real CRE agent tasks, run
      with and without FactLot. Publish the results.
- [ ] Recruit 10 design partners (see [customer discovery](customer-discovery.md)).

## Big track (registry)

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
