# Reddit post draft

> **DRAFT. FOR THE FOUNDER TO POST.** Nothing here has been posted. Post from the founder's own account, one subreddit at a time, and only after reading that subreddit's current rules page (`https://www.reddit.com/r/<name>/about/rules`).

## What could not be verified, stated first

Reddit refused every automated read in the session that wrote this kit (the fetch tool was blocked and `rules.json` returned nothing), so **the rule text of no subreddit below was read**. The notes are from search results and mirrors, read 2026-11-03, and are secondary evidence. The prompt asked for subreddits "whose rules allow it, with the rule cited"; that cannot be done honestly from here. Instead, each row says what is known and what the founder must confirm.

| Subreddit              | What is known (secondary sources, 2026-11-03)                                                                                                                                                                       | Confirm before posting                                                                                                   | Verdict                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| r/mcp                  | A third-party mirror of the subreddit shows posts tagged "[Showcase]" for MCP servers and a third-party analytics page lists self-promotion among its common post themes. No rule text was read.                    | Whether a Showcase flair or tag is required, and any limit on self-promotion frequency.                                  | Best fit. Post here first if the rules allow showcases.                                             |
| r/ClaudeAI             | A moderator-run "Built with Claude Project Showcase" megathread existed in April 2026 (mirror). A "Built with Claude" flair was used for a 2025 contest that has ended. No rule text was read.                      | Whether projects must go in the megathread; whether a flair is needed. Do not use "Built with Claude" unless it is true. | Use the megathread if it exists, not a top-level post.                                              |
| r/commercialrealestate | Rules not found. Real-estate subreddits often ban promotion outright (a mirror of a different real estate subreddit shows bans on advertising and self-promotion).                                                  | Message the moderators first (modmail) and ask whether a free open-source project post is allowed.                       | Do not post without a yes from the moderators. A helpful comment in a relevant thread is different. |
| r/selfhosted           | Rules updated March and April 2026: new projects go in a megathread; a minimum project age of three months was set in March; AI involvement must be disclosed; promoted apps need to be production ready with docs. | The current age rule. FactLot is days old in public, so it likely does not qualify.                                      | Skip for now; revisit when it is three months old.                                                  |
| r/LLMDevs              | A mirror notes that commercial promotion for monetary gain is prohibited.                                                                                                                                           | n/a                                                                                                                      | Skip: FactLot plans a paid hosted tier.                                                             |
| r/opensource           | Rules not found.                                                                                                                                                                                                    | Read the rules page.                                                                                                     | Optional, only if its rules allow project announcements.                                            |

Sources: [Reddit self-promotion guide](https://redship.io/blog/reddit-self-promotion-rules-2026) (secondary); the r/ClaudeAI showcase thread mirror ([redlib.groet-infra.nl](https://redlib.groet-infra.nl/r/ClaudeAI/comments/1sly3jm/built_with_claude_project_showcase_megathread/okwm51z/?context=3)); the r/selfhosted rules update mirror ([redlib.groet-infra.nl](https://redlib.groet-infra.nl/r/selfhosted/comments/1rmt39o/rules_update_new_project_friday_here_to_stay/o91wk8x)). The reader should treat all of these as hints, not rules.

## General Reddit conduct for this launch

- Disclose that you are the maintainer and that there is a possible paid hosted tier later. This is also the honest thing to do and the thing mods look for.
- One post per subreddit. No cross-posting the same text on the same day to many subreddits.
- No asking for upvotes. No alt accounts. No comments from other accounts praising it.
- Answer comments yourself, with specifics.

## Post (adapt the first line to the subreddit)

**Title (r/mcp):**

```
[Showcase] FactLot: open-source MCP server with 14 deterministic CRE calculators, audit trails and cited facts
```

**Body:**

```
I'm the maintainer and I'm sharing this to get feedback from people who build MCP clients and agents.

FactLot is an MCP server (and REST/OpenAPI server and Python SDK) for AI agents that do commercial real estate work. The idea is that an agent should call a tool for lease math instead of doing it in context, and that a fact should carry its source.

- 14 calculators (rent schedule, net effective rent, CAM reconciliation, debt sizing, ASC 842 remeasurement, WALT, IRR, lease vs. own, renew vs. relocate, hotel metrics and more). Each returns the value, every step, warnings and a versioned formula ID.
- Deterministic IDs for parcels, entities, spaces and documents.
- A fact schema with provenance and AI-use rights, and `fact_validate` to check a fact before you store it.
- Every tool has a title and a read-only annotation, and every input field is described, because agents read those.
- TypeScript and Python implementations pass the same test vectors, and a differential test in CI compares them on random inputs.

It runs locally over stdio with no API key. It is not on npm or PyPI yet, so install from GitHub (commands in the README). There is no hosted endpoint yet. The registry of public-record parcel and entity facts exists (708,538 commercial parcels, 12.9 M registered entities) but cannot be queried publicly yet. I have not run the included benchmark on current models, so I have no accuracy numbers to share.

Code is Apache-2.0 and MIT. A hosted registry may be a paid service later; the tools stay free.

Repo: https://github.com/9mp96ygnbk-alt/factlot

What would make you add or not add something like this to an agent? In particular: are the tool descriptions clear enough that your model picks the right calculator?
```
