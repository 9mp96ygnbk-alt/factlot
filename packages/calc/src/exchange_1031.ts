import { z } from "zod";

import {
  IsoDate,
  NonNegMoney,
  Trace,
  fmtMoney,
  parseInput,
  reduceNoise,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";
import { addDays, daysBetween } from "./dates.ts";

export const NOT_TAX_ADVICE =
  "Not tax advice. FactLot does arithmetic on the dates and amounts given: the 45- and 180-day counts of IRC §1031(a)(3), the identification limits of Treas. Reg. §1.1031(k)-1(c)(4), and the usual boot and debt-replacement netting. It does not decide whether an exchange qualifies; confirm with a qualified intermediary and a tax adviser.";

export const Exchange1031Input = z
  .object({
    relinquished_transfer_date: IsoDate.describe(
      "Date the relinquished property was transferred (closed), YYYY-MM-DD. With several relinquished properties, the earliest transfer starts both periods.",
    ),
    tax_return_due_date: IsoDate.optional().describe(
      "Due date, including extensions, of the taxpayer's federal return for the year of the transfer, YYYY-MM-DD. IRC §1031(a)(3)(B) ends the exchange period on this date if it is earlier than day 180. FactLot does not compute it.",
    ),
    as_of: IsoDate.optional().describe(
      "Date to count the days remaining from, YYYY-MM-DD. Optional.",
    ),
    relinquished: z
      .object({
        sale_price: z
          .number()
          .finite()
          .positive()
          .describe(
            "Contract sale price (fair market value) of the relinquished property, USD. Also the base of the 200% identification test.",
          ),
        selling_expenses: NonNegMoney.default(0).describe(
          "Exchange and closing expenses paid at the sale (commissions, title, QI fees), USD.",
        ),
        debt_relieved: NonNegMoney.default(0).describe(
          "Mortgages and other liabilities paid off or assumed by the buyer at the sale, USD.",
        ),
        adjusted_basis: NonNegMoney.optional().describe(
          "Taxpayer's adjusted basis in the relinquished property, USD. Optional; adds the realized gain and the boot-limited gain.",
        ),
      })
      .describe("The property given up."),
    cash_received_at_sale: NonNegMoney.default(0).describe(
      "Cash the taxpayer took from the sale proceeds instead of leaving them with the qualified intermediary, USD.",
    ),
    replacement: z
      .object({
        purchase_price: NonNegMoney.describe(
          "Total price of the replacement property or properties acquired, USD.",
        ),
        acquisition_costs: NonNegMoney.default(0).describe(
          "Closing costs paid at the purchase, USD.",
        ),
        new_debt: NonNegMoney.default(0).describe(
          "New or assumed mortgage debt on the replacement property, USD.",
        ),
      })
      .optional()
      .describe(
        "The property acquired (in total). Omit to check only the deadlines and identification.",
      ),
    identified_properties: z
      .array(
        z.object({
          name: z
            .string()
            .min(1)
            .max(200)
            .describe("Label for the identified property."),
          fair_market_value: z
            .number()
            .finite()
            .positive()
            .describe(
              "Fair market value at the end of the identification period, USD.",
            ),
          identified_date: IsoDate.optional().describe(
            "Date the written identification was delivered, YYYY-MM-DD. Optional; checked against the 45-day deadline.",
          ),
          received: z
            .boolean()
            .default(false)
            .describe("Whether the taxpayer acquired this property."),
          received_date: IsoDate.optional().describe(
            "Date it was acquired, YYYY-MM-DD. Optional; checked against the exchange deadline.",
          ),
        }),
      )
      .max(100)
      .default([])
      .describe(
        "Replacement properties identified in writing. Empty to skip the identification checks.",
      ),
  })
  .superRefine((v, ctx) => {
    const start = v.relinquished_transfer_date;
    if (v.tax_return_due_date !== undefined && v.tax_return_due_date < start)
      ctx.addIssue({
        code: "custom",
        path: ["tax_return_due_date"],
        message: "must not be before relinquished_transfer_date",
      });
  });
export type Exchange1031Input = z.input<typeof Exchange1031Input>;

export type IdentificationRule =
  "three_property" | "200_percent" | "95_percent";

export interface Exchange1031 {
  disclaimer: string;
  deadlines: {
    transfer_date: string;
    identification_deadline: string;
    exchange_deadline: string;
    /** "180_days" or "tax_return_due_date" (IRC §1031(a)(3)(B)(ii)), whichever is earlier. */
    exchange_deadline_basis: "180_days" | "tax_return_due_date";
    day_180: string;
    days_to_identification_deadline: number | null;
    days_to_exchange_deadline: number | null;
  };
  identification: {
    count: number;
    total_fair_market_value: number;
    /** Identified FMV ÷ relinquished sale price. */
    ratio_to_relinquished: number;
    three_property_rule: boolean;
    two_hundred_percent_rule: boolean;
    /** Received FMV ÷ identified FMV, for the 95% exception. */
    received_share: number;
    ninety_five_percent_exception: boolean;
    rule_met: IdentificationRule | null;
    late_identifications: string[];
    late_receipts: string[];
  } | null;
  exchange: {
    amount_realized: number;
    exchange_equity: number;
    qualified_intermediary_funds: number;
    funds_needed_at_purchase: number;
    funds_applied_from_qi: number;
    additional_cash_paid: number;
    cash_boot: number;
    debt_relieved: number;
    debt_replaced: number;
    mortgage_boot: number;
    total_boot: number;
    /** New debt (or added cash) still needed to offset the debt relieved. */
    debt_replacement_shortfall: number;
    /** Amount realized not matched by the replacement price. */
    trade_down: number;
    realized_gain: number | null;
    /** min(realized gain, total boot): the most gain the boot can make taxable (IRC §1031(b)); before depreciation recapture and other rules. */
    boot_limited_gain: number | null;
  } | null;
}

/**
 * Deterministic 1031 exchange checks: statutory deadlines, identification limits, and
 * boot and debt-replacement arithmetic. Not tax advice.
 */
export function exchange1031(raw: Exchange1031Input): CalcResult<Exchange1031> {
  const input = parseInput(Exchange1031Input, raw);
  const t = new Trace();
  const start = input.relinquished_transfer_date;
  const idDeadline = t.step(
    "Identification deadline",
    addDays(start, 45),
    `IRC §1031(a)(3)(A): ${start} + 45 days`,
  );
  const day180 = addDays(start, 180);
  const due = input.tax_return_due_date;
  const dueFirst = due !== undefined && due < day180;
  const exDeadline = t.step(
    "Exchange deadline",
    dueFirst ? (due as string) : day180,
    dueFirst
      ? `IRC §1031(a)(3)(B)(ii): the return due date ${due} is earlier than day 180 (${day180})`
      : `IRC §1031(a)(3)(B): ${start} + 180 days${due !== undefined ? `, before the return due date ${due}` : ""}`,
  );
  const asOf = input.as_of;
  const left = (d: string): number | null =>
    asOf === undefined ? null : daysBetween(asOf, d);
  if (asOf !== undefined)
    t.step(
      "Days remaining",
      `${left(idDeadline)} to identify, ${left(exDeadline)} to close`,
      `from ${asOf}`,
    );

  const rel = input.relinquished;
  let identification: Exchange1031["identification"] = null;
  const props = input.identified_properties;
  if (props.length > 0) {
    let total = 0;
    let received = 0;
    for (const x of props) {
      total += x.fair_market_value;
      if (x.received) received += x.fair_market_value;
    }
    const three = props.length <= 3;
    const twoHundred = reduceNoise(total) <= reduceNoise(2 * rel.sale_price);
    const late = props
      .filter(
        (x) =>
          x.identified_date !== undefined && x.identified_date > idDeadline,
      )
      .map((x) => x.name);
    const lateReceipts = props
      .filter(
        (x) =>
          x.received &&
          x.received_date !== undefined &&
          x.received_date > exDeadline,
      )
      .map((x) => x.name);
    const ninetyFive =
      reduceNoise(received) >= reduceNoise(0.95 * total) &&
      lateReceipts.length === 0;
    const rule: IdentificationRule | null = three
      ? "three_property"
      : twoHundred
        ? "200_percent"
        : ninetyFive
          ? "95_percent"
          : null;
    t.step(
      "Three-property rule",
      three ? "met" : "not met",
      `Treas. Reg. §1.1031(k)-1(c)(4)(i)(A): ${props.length} identified, at most 3`,
    );
    t.step(
      "200% rule",
      twoHundred ? "met" : "not met",
      `Treas. Reg. §1.1031(k)-1(c)(4)(i)(B): ${fmtMoney(total)} identified ≤ 200% × ${fmtMoney(rel.sale_price)} = ${fmtMoney(2 * rel.sale_price)}`,
    );
    if (!three && !twoHundred)
      t.step(
        "95% exception",
        ninetyFive ? "met" : "not met",
        `Treas. Reg. §1.1031(k)-1(c)(4)(ii)(B): ${fmtMoney(received)} received ≥ 95% × ${fmtMoney(total)} = ${fmtMoney(0.95 * total)}, each by the exchange deadline`,
      );
    identification = {
      count: props.length,
      total_fair_market_value: round(total, 2),
      ratio_to_relinquished: round(total / rel.sale_price, 4),
      three_property_rule: three,
      two_hundred_percent_rule: twoHundred,
      received_share: total > 0 ? round(received / total, 4) : 0,
      ninety_five_percent_exception: ninetyFive,
      rule_met: rule,
      late_identifications: late,
      late_receipts: lateReceipts,
    };
    if (rule === null)
      t.warn(
        "The identification meets none of the three-property, 200%, or 95% tests: Treas. Reg. §1.1031(k)-1(c)(4)(ii)(A) treats the taxpayer as having identified no replacement property.",
      );
    if (late.length > 0)
      t.warn(
        `Identified after the ${idDeadline} deadline: ${late.join(", ")}.`,
      );
    if (lateReceipts.length > 0)
      t.warn(
        `Received after the ${exDeadline} exchange deadline: ${lateReceipts.join(", ")}.`,
      );
    if (rule === "95_percent")
      t.warn(
        "The identification relies on the 95% exception, which counts only property actually received by the exchange deadline.",
      );
  }

  let exchange: Exchange1031["exchange"] = null;
  const rep = input.replacement;
  if (rep !== undefined) {
    const realized = t.step(
      "Amount realized",
      round(rel.sale_price - rel.selling_expenses, 2),
      `${fmtMoney(rel.sale_price)} sale price − ${fmtMoney(rel.selling_expenses)} selling expenses`,
      "USD",
    );
    const equity = t.step(
      "Exchange equity",
      round(realized - rel.debt_relieved, 2),
      `${fmtMoney(realized)} − ${fmtMoney(rel.debt_relieved)} debt relieved`,
      "USD",
    );
    const qi = t.step(
      "Funds with the qualified intermediary",
      round(Math.max(0, equity - input.cash_received_at_sale), 2),
      `max(0, ${fmtMoney(equity)} − ${fmtMoney(input.cash_received_at_sale)} cash taken at the sale)`,
      "USD",
    );
    const needed = t.step(
      "Funds needed at the purchase",
      round(rep.purchase_price + rep.acquisition_costs - rep.new_debt, 2),
      `${fmtMoney(rep.purchase_price)} price + ${fmtMoney(rep.acquisition_costs)} costs − ${fmtMoney(rep.new_debt)} new debt`,
      "USD",
    );
    const applied = round(Math.max(0, Math.min(qi, needed)), 2);
    const added = t.step(
      "Additional cash paid",
      round(Math.max(0, needed - qi), 2),
      "cash the taxpayer adds beyond the exchange funds",
      "USD",
    );
    const cashBoot = t.step(
      "Cash boot",
      round(
        input.cash_received_at_sale + Math.max(0, qi - Math.max(0, needed)),
        2,
      ),
      `${fmtMoney(input.cash_received_at_sale)} taken at the sale + exchange funds not used for the purchase; not offset by new debt (Treas. Reg. §1.1031(d)-2, Example 2)`,
      "USD",
    );
    const replaced = round(rep.new_debt + added, 2);
    const mortgageBoot = t.step(
      "Mortgage boot",
      round(Math.max(0, rel.debt_relieved - replaced), 2),
      `max(0, ${fmtMoney(rel.debt_relieved)} debt relieved − ${fmtMoney(rep.new_debt)} new debt − ${fmtMoney(added)} cash added) (Treas. Reg. §1.1031(d)-2)`,
      "USD",
    );
    const totalBoot = t.step(
      "Total boot",
      round(cashBoot + mortgageBoot, 2),
      "cash boot + mortgage boot",
      "USD",
    );
    const tradeDown = t.step(
      "Trade-down",
      round(Math.max(0, realized - rep.purchase_price), 2),
      `max(0, ${fmtMoney(realized)} amount realized − ${fmtMoney(rep.purchase_price)} replacement price)`,
      "USD",
    );
    let gain: number | null = null;
    let limited: number | null = null;
    if (rel.adjusted_basis !== undefined) {
      gain = t.step(
        "Realized gain",
        round(realized - rel.adjusted_basis, 2),
        `${fmtMoney(realized)} − ${fmtMoney(rel.adjusted_basis)} adjusted basis`,
        "USD",
      );
      limited = t.step(
        "Boot-limited gain",
        round(Math.max(0, Math.min(gain, totalBoot)), 2),
        "IRC §1031(b): gain is recognized up to the boot received: min(realized gain, total boot)",
        "USD",
      );
    }
    exchange = {
      amount_realized: realized,
      exchange_equity: equity,
      qualified_intermediary_funds: qi,
      funds_needed_at_purchase: needed,
      funds_applied_from_qi: applied,
      additional_cash_paid: added,
      cash_boot: cashBoot,
      debt_relieved: rel.debt_relieved,
      debt_replaced: replaced,
      mortgage_boot: mortgageBoot,
      total_boot: totalBoot,
      debt_replacement_shortfall: mortgageBoot,
      trade_down: tradeDown,
      realized_gain: gain,
      boot_limited_gain: limited,
    };
    if (cashBoot > 0)
      t.warn(
        `${fmtMoney(cashBoot)} of cash boot: exchange funds not reinvested are taxable to the extent of gain.`,
      );
    if (mortgageBoot > 0)
      t.warn(
        `${fmtMoney(mortgageBoot)} of mortgage boot: replace the relieved debt with new debt or added cash to avoid it.`,
      );
    if (tradeDown > 0 && totalBoot === 0)
      t.warn(
        "The replacement price is below the amount realized but no boot results; check the debt and cash figures.",
      );
    if (needed < 0)
      t.warn(
        "The new debt exceeds the price plus costs; loan proceeds beyond the purchase are not counted as boot here.",
      );
    if (equity < 0)
      t.warn(
        "The debt relieved exceeds the amount realized (negative equity); the excess is mortgage boot unless offset.",
      );
  }

  if (due === undefined)
    t.warn(
      `tax_return_due_date not given: under IRC §1031(a)(3)(B)(ii) the exchange period ends on the due date (with extensions) of the return for the year of the transfer if that is before ${day180}. Supply it, or confirm an extension is filed.`,
    );
  t.warn(
    "The deadlines are calendar-day counts and are not moved for weekends or holidays; disaster postponements (IRC §7508A) are not applied.",
  );
  t.warn(NOT_TAX_ADVICE);

  return t.result("calc.exchange_1031", 1, {
    disclaimer: NOT_TAX_ADVICE,
    deadlines: {
      transfer_date: start,
      identification_deadline: idDeadline,
      exchange_deadline: exDeadline,
      exchange_deadline_basis: dueFirst ? "tax_return_due_date" : "180_days",
      day_180: day180,
      days_to_identification_deadline: left(idDeadline),
      days_to_exchange_deadline: left(exDeadline),
    },
    identification,
    exchange,
  });
}
