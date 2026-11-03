# @factlot/tools

The FactLot tool catalog: 21 core tools (14 calculators, 1 rules pack, 5 FactLot ID tools, and fact validation), plus 6 registry tools that need a registry database. Every tool has
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
