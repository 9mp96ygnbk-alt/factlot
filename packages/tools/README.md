# @factlot/tools

The FactLot tool catalog: 15 tools (calculators, FactLot IDs, and fact validation), each with
native definitions for every major AI platform and one dispatcher, `runTool`.

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
