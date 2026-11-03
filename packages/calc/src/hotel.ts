import { z } from "zod";

import {
  CalcInputError,
  NonNegMoney,
  Trace,
  fmtMoney,
  fmtPct,
  parseInput,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";

const ShareOfRevenue = z.number().finite().min(0).lt(1).default(0);

export const HotelMetricsInput = z.object({
  nights: z
    .number()
    .int()
    .positive()
    .describe("Nights in the period, e.g. 365 for a year or 30 for a month."),
  rooms: z.number().int().positive().describe("Rooms in inventory (keys)."),
  rooms_out_of_order: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      "Room-nights removed from inventory in the period (renovation, damage). USALI excludes these from rooms available.",
    ),
  rooms_sold: z
    .number()
    .int()
    .min(0)
    .describe(
      "Room-nights occupied by paying guests in the period (USALI: rooms sold, excluding complimentary rooms).",
    ),
  room_revenue: NonNegMoney.describe(
    "Rooms revenue for the period, USD (USALI Rooms department revenue, net of taxes and allowances).",
  ),
  fb_revenue: NonNegMoney.default(0).describe(
    "Food and beverage revenue, USD (USALI Food and Beverage department revenue).",
  ),
  other_revenue: NonNegMoney.default(0).describe(
    "Other operated departments plus miscellaneous income, USD (USALI Other Operated Departments and Miscellaneous Income).",
  ),
  departmental_expenses: NonNegMoney.default(0).describe(
    "Total departmental expenses, USD: rooms, F&B, and other operated departments (USALI Total Departmental Expenses).",
  ),
  undistributed_expenses: NonNegMoney.default(0).describe(
    "Total undistributed operating expenses, USD: administrative and general, information and telecommunications, sales and marketing, property operation and maintenance, utilities (USALI Total Undistributed Operating Expenses).",
  ),
  management_fee_rate: ShareOfRevenue.describe(
    "Base management fee as a share of total operating revenue, e.g. 0.03 (USALI Management Fees).",
  ),
  management_fee_fixed: NonNegMoney.default(0).describe(
    "Fixed or incentive management fee for the period, USD, added to the percentage fee (USALI Management Fees).",
  ),
  non_operating_expenses: NonNegMoney.default(0).describe(
    "Property taxes, insurance, ground rent, and other non-operating expenses, USD (USALI Non-Operating Income and Expenses).",
  ),
  ffe_reserve_rate: ShareOfRevenue.describe(
    "FF&E replacement reserve as a share of total operating revenue, e.g. 0.04 (USALI Replacement Reserve, below EBITDA).",
  ),
});
export type HotelMetricsInput = z.input<typeof HotelMetricsInput>;

export interface HotelMetrics {
  rooms_available: number;
  rooms_sold: number;
  /** Rooms sold ÷ rooms available. */
  occupancy: number;
  /** Average daily rate: rooms revenue ÷ rooms sold; null when no rooms were sold. */
  adr: number | null;
  /** Revenue per available room: rooms revenue ÷ rooms available. */
  revpar: number;
  /** Total revenue per available room. */
  trevpar: number;
  total_revenue: number;
  /** USALI Total Departmental Profit. */
  departmental_profit: number;
  /** USALI Gross Operating Profit. */
  gop: number;
  gop_margin: number;
  /** GOP per available room-night. */
  goppar: number;
  management_fee: number;
  /** USALI Income Before Non-Operating Income and Expenses. */
  income_before_non_operating: number;
  /** USALI EBITDA (after non-operating expenses, before the replacement reserve). */
  ebitda: number;
  ffe_reserve: number;
  /** USALI EBITDA Less Replacement Reserve, the NOI used in valuation. */
  noi: number;
  noi_margin: number;
}

/**
 * Hotel operating statistics and a USALI-style profit ladder for one period:
 * occupancy, ADR, RevPAR, TRevPAR, departmental profit, GOP, management fees,
 * EBITDA, FF&E reserve, and NOI (EBITDA less replacement reserve).
 */
export function hotelMetrics(raw: HotelMetricsInput): CalcResult<HotelMetrics> {
  const input = parseInput(HotelMetricsInput, raw);
  const t = new Trace();
  const available = input.rooms * input.nights - input.rooms_out_of_order;
  if (available <= 0)
    throw new CalcInputError(
      "rooms_out_of_order leaves no rooms available in the period",
    );
  if (input.rooms_sold > available)
    throw new CalcInputError(
      `rooms_sold (${input.rooms_sold}) exceeds rooms available (${available})`,
    );
  t.step(
    "Rooms available",
    available,
    `${input.rooms} rooms × ${input.nights} nights − ${input.rooms_out_of_order} out of order`,
    "room-nights",
  );
  const occupancy = t.step(
    "Occupancy",
    round(input.rooms_sold / available, 4),
    `${input.rooms_sold} sold ÷ ${available} available = ${fmtPct(input.rooms_sold / available)}`,
  );
  const adr =
    input.rooms_sold > 0
      ? round(input.room_revenue / input.rooms_sold, 2)
      : null;
  t.step(
    "ADR",
    adr ?? "n/a",
    adr === null
      ? "no rooms sold"
      : `${fmtMoney(input.room_revenue)} rooms revenue ÷ ${input.rooms_sold} rooms sold`,
    "USD",
  );
  const revpar = t.step(
    "RevPAR",
    round(input.room_revenue / available, 2),
    `${fmtMoney(input.room_revenue)} ÷ ${available} available (= occupancy × ADR)`,
    "USD",
  );
  const totalRevenue = t.step(
    "Total operating revenue",
    round(input.room_revenue + input.fb_revenue + input.other_revenue, 2),
    `${fmtMoney(input.room_revenue)} rooms + ${fmtMoney(input.fb_revenue)} F&B + ${fmtMoney(input.other_revenue)} other`,
    "USD",
  );
  const trevpar = t.step(
    "TRevPAR",
    round(totalRevenue / available, 2),
    `${fmtMoney(totalRevenue)} ÷ ${available} available`,
    "USD",
  );
  const deptProfit = t.step(
    "Departmental profit",
    round(totalRevenue - input.departmental_expenses, 2),
    `${fmtMoney(totalRevenue)} − ${fmtMoney(input.departmental_expenses)} departmental expenses (USALI Total Departmental Profit)`,
    "USD",
  );
  const gop = t.step(
    "GOP",
    round(deptProfit - input.undistributed_expenses, 2),
    `${fmtMoney(deptProfit)} − ${fmtMoney(input.undistributed_expenses)} undistributed expenses (USALI Gross Operating Profit)`,
    "USD",
  );
  const gopMargin = t.step(
    "GOP margin",
    totalRevenue > 0 ? round(gop / totalRevenue, 4) : 0,
    "GOP ÷ total operating revenue",
  );
  const goppar = t.step(
    "GOPPAR",
    round(gop / available, 2),
    `${fmtMoney(gop)} ÷ ${available} available`,
    "USD",
  );
  const mgmtFee = t.step(
    "Management fee",
    round(
      totalRevenue * input.management_fee_rate + input.management_fee_fixed,
      2,
    ),
    `${fmtMoney(totalRevenue)} × ${fmtPct(input.management_fee_rate)} + ${fmtMoney(input.management_fee_fixed)} fixed (USALI Management Fees)`,
    "USD",
  );
  const ibnoie = t.step(
    "Income before non-operating",
    round(gop - mgmtFee, 2),
    `${fmtMoney(gop)} − ${fmtMoney(mgmtFee)} (USALI Income Before Non-Operating Income and Expenses)`,
    "USD",
  );
  const ebitda = t.step(
    "EBITDA",
    round(ibnoie - input.non_operating_expenses, 2),
    `${fmtMoney(ibnoie)} − ${fmtMoney(input.non_operating_expenses)} property taxes, insurance, other non-operating (USALI EBITDA)`,
    "USD",
  );
  const reserve = t.step(
    "FF&E reserve",
    round(totalRevenue * input.ffe_reserve_rate, 2),
    `${fmtMoney(totalRevenue)} × ${fmtPct(input.ffe_reserve_rate)} (USALI Replacement Reserve)`,
    "USD",
  );
  const noi = t.step(
    "NOI",
    round(ebitda - reserve, 2),
    `${fmtMoney(ebitda)} − ${fmtMoney(reserve)} (USALI EBITDA Less Replacement Reserve)`,
    "USD",
  );
  const noiMargin = t.step(
    "NOI margin",
    totalRevenue > 0 ? round(noi / totalRevenue, 4) : 0,
    "NOI ÷ total operating revenue",
  );

  if (adr === null) t.warn("No rooms sold in the period; ADR is undefined.");
  if (input.departmental_expenses === 0 && input.undistributed_expenses === 0)
    t.warn(
      "No expenses supplied; GOP and NOI equal revenue. Add departmental and undistributed expenses for a profit view.",
    );
  if (input.ffe_reserve_rate === 0)
    t.warn(
      "No FF&E reserve; lenders and appraisers typically deduct 3–5% of revenue before NOI.",
    );
  if (input.non_operating_expenses === 0)
    t.warn(
      "No property taxes or insurance supplied; NOI is before those non-operating expenses.",
    );

  return t.result("calc.hotel_metrics", 1, {
    rooms_available: available,
    rooms_sold: input.rooms_sold,
    occupancy,
    adr,
    revpar,
    trevpar,
    total_revenue: totalRevenue,
    departmental_profit: deptProfit,
    gop,
    gop_margin: gopMargin,
    goppar,
    management_fee: mgmtFee,
    income_before_non_operating: ibnoie,
    ebitda,
    ffe_reserve: reserve,
    noi,
    noi_margin: noiMargin,
  });
}
