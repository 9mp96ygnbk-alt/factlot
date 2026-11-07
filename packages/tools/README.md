# @factlot/tools

The FactLot tool catalog: 45 core tools (26 calculators, 1 rules pack, 6 FactLot ID tools, 3 fact tools, 7 document tools and 2 lease comp tools), plus 8 registry tools that answer from a registry database or from the hosted registry service. Every tool has
native definitions for every major AI platform, and one dispatcher, `runTool`, runs them all.

```ts
import {
  anthropicTools,
  openaiChatTools,
  openaiResponsesTools,
  geminiTools,
  bedrockConverseToolConfig,
  openApi31,
  runTool,
} from "@factlot/tools";

const outcome = runTool("calc_debt_sizing", {
  noi: 1_000_000,
  value: 15_000_000,
  rate_annual: 0.06,
  amortization_years: 30,
  max_ltv: 0.65,
});
// { ok: true, result: { value, formula, steps, warnings, provenance } } | { ok: false, error: { error, message, issues } }
```

Part of [FactLot](https://github.com/9mp96ygnbk-alt/factlot). License: MIT.
