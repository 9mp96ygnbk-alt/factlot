# Show HN draft

> **DRAFT. FOR THE FOUNDER TO POST.** Nothing here has been posted. Post from the founder's own account at 12:00 EST on 2026-11-03, after the repository is public. Do not ask anyone to upvote; Hacker News forbids it ([Show HN rules](https://news.ycombinator.com/showhn.html), read 2026-11-03). Link the repository, not the landing page: the rules exclude landing pages and sign-up pages, and want something people can run now.

## Title (under 80 characters)

```
Show HN: FactLot – cited facts and audited math for commercial real estate AI
```

(77 characters including "Show HN: ". Alternative: `Show HN: FactLot, an open fact layer for commercial real estate AI agents` is 73.)

## URL

```
https://github.com/9mp96ygnbk-alt/factlot
```

## First comment (post immediately after submitting)

```
I'm a solo founder. FactLot is an open-source set of tools for AI agents that do commercial real estate (CRE) work: underwriting, lease abstraction, CAM reconciliation, property tax appeals. It exists because agents fail in three places: arithmetic, citations and identity.

What works today:

- 14 deterministic calculators (rent schedule, net effective rent, proposal comparison, percentage rent, CAM reconciliation, debt sizing, ASC 842 remeasurement, prepayment and defeasance, WALT, NPV, IRR, lease vs. own, renew vs. relocate, hotel metrics). Each returns the value, every intermediate step, warnings, and a versioned formula ID like calc.cam_reconciliation@1, so a human can check the work.
- FactLot IDs: deterministic IDs for parcels, legal entities, spaces and documents that any agent can compute offline, so two systems that say "the same parcel" produce the same key.
- A fact schema in which every claim has provenance (document, page, clause, method) and rights (may an AI use or redistribute it).
- An MCP server that runs locally over stdio, with no API key and no network calls, plus a REST/OpenAPI server and a Python SDK. The TypeScript and Python implementations are checked against shared test vectors and a differential test that runs random inputs through both and fails on any difference.
- A registry built only from public records: 708,538 commercial parcels and 12.9 M registered entities from 18 verified sources (Texas's five largest counties, NYC, Los Angeles, San Francisco, Boston, Denver, Charlotte, Minneapolis, DC, and state entity registries). Each fact cites the file and record it came from and the publisher's licence.

What does not work yet, so you don't have to find out:

- It is not on npm or PyPI. Install from GitHub: clone, npm install, npm run build, point your MCP client at node packages/mcp/dist/bin.js; or build the Docker image; or pip install from the Git URL. Commands are in the README.
- There is no hosted public endpoint. The registry data is not queryable by the public yet.
- Registry coverage is limited to the places listed above, uneven, commercial/industrial/multifamily parcels only, and some public files omit owner names. No sales prices, tenants or debt.
- Lease ingestion is a prototype with no published accuracy number. One rules pack exists (the Texas property tax protest deadline, checked against the statute).
- FactLot Bench (14 tasks with independently computed answers, model alone vs. model plus FactLot tools) exists, but I have not run it on current models, so I have no result to show.
- The "165-persona survey" in the docs is simulated: AI personas role-playing. It is a hypothesis generator, not customers, and I say so in the docs. I have no paying users yet.

The business model is open core: the code is Apache-2.0 and MIT; a hosted registry may be paid later. If you or your team want cited parcel-to-owner-to-entity lookups without self-hosting, the README has an early-access email link; early-access teams will help set pricing.

I'd like to know: which calculators would you not trust until you've seen the formula? Which CRE tasks have you tried to hand to an agent and had fail? Bug reports and wrong-number reports go in GitHub Issues; questions in Discussions.
```

## If asked

- "Why not just write a spreadsheet?" A spreadsheet is a fine tool; the point is that an agent can call it, get steps back, and cite a formula ID, and that two languages agree to the last digit.
- "Why not use a vendor's MCP server?" Several incumbents ship MCP servers and are strong on coverage. FactLot is complementary: calculators and IDs need no data licence, and registry facts carry their source's licence and AI-use status. See `docs/business/market.md`.
- "Is the data legal to use?" Each source has a review record under `docs/registry/sources/` with the terms quoted. Two loaded sources (Tarrant, Mecklenburg) signal "no AI training" in robots.txt and the record says so. Other sources are held back until their terms, forms or purchases are settled.
