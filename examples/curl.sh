#!/usr/bin/env bash
# FactLot over plain HTTP. No key needed on the free tier.
set -euo pipefail
API="${FACTLOT_API_URL:-https://api.factlot.com}"
AUTH=()
if [ -n "${FACTLOT_API_KEY:-}" ]; then AUTH=(-H "authorization: Bearer $FACTLOT_API_KEY"); fi

call() { # call <path> <json>
  curl -fsS "$API$1" -H 'content-type: application/json' ${AUTH[@]+"${AUTH[@]}"} -d "$2"
}
show() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps({"value": d.get("value"), "formula": d.get("formula"), "warnings": d.get("warnings")}, indent=2)[:1500])'; }

echo "== Loan sizing: NOI \$1.0M, value \$15M, 6.5% / 30-year, max 65% LTV, min 1.25x DSCR"
call /v1/calc/debt_sizing '{"noi":1000000,"value":15000000,"rate_annual":0.065,"amortization_years":30,"max_ltv":0.65,"min_dscr":1.25}' | show

echo "== Net effective rent: 10,000 SF, 10 years at \$40/SF/yr, 6 months free, \$50/SF TI, \$100k commissions"
call /v1/calc/net_effective_rent '{"schedule":{"commencement_date":"2026-01-01","term_months":120,"area_sf":10000,"starting_rent_psf_annual":40,"abated_months":[1,2,3,4,5,6]},"ti_allowance_psf":50,"leasing_commissions":100000,"discount_rate_annual":0.08}' | show

echo "== CAM reconciliation with gross-up, an excluded capital item and a 5% compounding cap"
call /v1/calc/cam_reconciliation '{"year":2026,"pro_rata_share":0.1,"expenses":[{"category":"real estate taxes","amount":300000,"controllable":false},{"category":"insurance","amount":50000,"controllable":false},{"category":"janitorial","amount":200000,"variable":true},{"category":"repairs & maintenance","amount":150000},{"category":"roof replacement","amount":400000,"recoverable":false}],"gross_up":{"actual_occupancy":0.8,"target_occupancy":0.95},"estimates_paid":60000,"cap":{"method":"compounding_from_base","rate":0.05,"reference_amount":30000,"years_elapsed":3}}' | show

echo "== A canonical parcel ID (Los Angeles County APN 5432-001-012)"
call /v1/id/parcel '{"state_fips":"06","county_fips":"037","apn":"5432-001-012"}'
echo
