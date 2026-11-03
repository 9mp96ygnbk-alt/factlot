# LinkedIn post draft

> **DRAFT. FOR THE FOUNDER TO POST.** Nothing here has been posted. Post from the founder's personal profile after the repository is public. Post once; share in a CRE or proptech group only where that group's rules allow it. Do not tag people to gain reach, and do not message strangers in bulk.

## Post

```
If you let an AI agent do lease math, check the number it gives you.

A language model can work out net effective rent or a loan-sizing constraint differently each time, and cannot show its work. A number with no source document, page and clause cannot go into a credit memo, a CAM dispute or a property tax appeal.

So I built FactLot, and today it is open source.

What it is: tools an AI agent can call instead of guessing.

• 14 calculators for CRE work: rent schedules, net effective rent, proposal comparison, percentage rent, CAM reconciliation, debt sizing, ASC 842 remeasurement, prepayment and defeasance, WALT, IRR and NPV, lease vs. own, renew vs. relocate, hotel metrics. Every result shows its steps and a versioned formula ID, so you can check the work.
• A fact format where every claim carries its source (document, page, clause) and whether an AI is allowed to use it.
• Stable IDs for parcels, owners, suites and documents, so "123 Main LLC" in a lease and the same owner at the Secretary of State can be tied together.
• A registry built only from public records: 708,538 commercial parcels and 12.9 million registered entities so far, each fact citing its source file.

What it does not do yet, plainly: it is not on npm or PyPI, there is no hosted service, coverage is uneven (Texas's five largest counties, NYC, LA, SF, Boston, Denver, Charlotte, Minneapolis and DC), and lease ingestion is a prototype. I have not interviewed customers yet; the research in the repo is simulated and labelled that way.

It works with Claude, ChatGPT, Gemini, Copilot and Bedrock through MCP, REST/OpenAPI or function calling. The code is free (Apache-2.0 and MIT): github.com/9mp96ygnbk-alt/factlot

If your team builds or uses AI agents for lending, lease administration, appraisal, tax appeals or due diligence and wants cited parcel-to-owner-to-entity lookups without hosting anything yourself, I am taking early-access requests at contact@factlot.com. The hosted service is not public yet, and early-access teams will help set pricing.

I would also like to hear which CRE task you have tried to give an agent and where it went wrong.

#commercialrealestate #proptech #AI #opensource
```

## Notes for the founder

- The first screen of the post (before "see more") is the first two lines. They are about the problem, not the product.
- Reply to comments yourself. If someone asks for a number the repository does not contain (accuracy, customer count, uptime), say it is not available yet.
