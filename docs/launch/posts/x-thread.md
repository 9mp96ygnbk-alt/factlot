# X thread draft

> **DRAFT. FOR THE FOUNDER TO POST.** Nothing here has been posted. Post from the founder's account after the repository is public. Five posts. No hashtags beyond one; no tagging of accounts to gain reach.

**1/5**

```
AI agents are fluent about commercial real estate and often wrong about the facts: the math, the source, the owner.

I built FactLot, an open fact layer for CRE agents. Open source today: github.com/9mp96ygnbk-alt/factlot
```

**2/5**

```
14 deterministic calculators an agent can call instead of guessing: rent schedules, net effective rent, CAM reconciliation, debt sizing, ASC 842 remeasurement, WALT, IRR, lease vs. own, renew vs. relocate and more.

Each returns every step, warnings and a versioned formula ID like calc.cam_reconciliation@1.
```

**3/5**

```
Two implementations, TypeScript and Python, run against shared test vectors. A differential test in CI feeds random inputs through both and fails on any difference, down to the last digit.

Runs locally over MCP with no API key. Works with Claude, ChatGPT, Gemini, Copilot and Bedrock.
```

**4/5**

```
The registry is built only from public records: 708,538 commercial parcels, 12.9M registered entities, 18 verified sources. Every fact cites its source file and the publisher's licence.

Coverage is uneven (Texas, NYC, LA, SF, Boston, Denver, Charlotte, Minneapolis, DC). Details in the repo.
```

**5/5**

```
Not done yet: not on npm or PyPI (install from GitHub), no hosted endpoint, Bench not run on current models, lease ingestion is a prototype. The survey in the docs is simulated, not customers.

Want hosted cited lookups when they exist? contact@factlot.com. Bugs and questions: GitHub.
```
