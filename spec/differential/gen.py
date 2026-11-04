"""Generate random calculator (valuation ones in gen_valuation.py), rule and document-tool inputs for the TypeScript/Python differential test.

Usage: python gen.py SEED COUNT OUT.json
"""
import json, random
import sys
random.seed(int(sys.argv[1]))
def sched():
    esc=random.choice([{"type":"none"},{"type":"percent","rate":round(random.uniform(0,0.06),4)},{"type":"fixed_psf","amount":round(random.uniform(0,2),2),"every_months":random.choice([12,24])}])
    term=random.randint(1,180)
    return {"commencement_date":f"20{random.randint(20,35)}-{random.randint(1,12):02d}-{random.choice([1,15,28,29,30,31]):02d}","term_months":term,
            "area_sf":round(random.uniform(500,250000),random.choice([0,2])),"starting_rent_psf_annual":round(random.uniform(5,120),2),
            "escalation":esc,"abated_months":sorted(random.sample(range(1,term+1),min(term,random.randint(0,12)))),"round_rate_to_cents":random.random()<0.3}
cases=[]
for _ in range(int(sys.argv[2])):
    k=random.choice(["rent_schedule","net_effective_rent","compare_proposals","percentage_rent","cam_reconciliation","debt_sizing","walt","npv","irr","lease_remeasurement_asc842","prepayment_and_defeasance","lease_vs_own","renew_vs_relocate","hotel_metrics"])
    if k=="rent_schedule": inp=sched()
    elif k=="net_effective_rent": inp={"schedule":sched(),"ti_allowance_psf":round(random.uniform(0,150),2),"leasing_commissions":round(random.uniform(0,500000),2),"discount_rate_annual":round(random.uniform(0,0.15),4)}
    elif k=="compare_proposals":
        inp={"perspective":random.choice(["tenant","landlord"]),"discount_rate_annual":round(random.uniform(0,0.15),4),"proposals":[{"name":f"P{i}","schedule":sched(),"ti_allowance_psf":round(random.uniform(0,100),2),"additional_costs_psf_annual":round(random.uniform(0,20),2),"tenant_upfront_costs":round(random.uniform(0,1e5),2),"leasing_commissions":round(random.uniform(0,1e5),2)} for i in range(random.randint(2,5))]}
        if random.random()<0.5:
            inp["area_basis"]=random.choice(["rentable","usable"])
            for pr in inp["proposals"]:
                if random.random()<0.5: pr["load_factor"]=round(random.uniform(1,1.3),3)
                else: pr["usable_sf"]=round(pr["schedule"]["area_sf"]/random.uniform(1,1.3),random.choice([0,2]))
        for pr in inp["proposals"]:
            if random.random()<0.5:
                t=random.choice(["gross","nnn","base_year","expense_stop"]); o={"type":t,"expense_psf_annual":round(random.uniform(0,25),2),"growth_rate_annual":random.choice([0,round(random.uniform(-0.02,0.06),4)])}
                if t=="base_year" and random.random()<0.5: o["base_year_psf_annual"]=round(random.uniform(0,25),2)
                if t=="expense_stop": o["stop_psf_annual"]=round(random.uniform(0,25),2)
                pr["operating_expenses"]=o
            if random.random()<0.3: pr["downtime_months"]=random.randint(0,18)
    elif k=="percentage_rent": inp={"gross_sales":round(random.uniform(0,2e7),2),"sales_exclusions":round(random.uniform(0,1e6),2),"rate":round(random.uniform(0.01,0.12),4),"base_rent_annual":round(random.uniform(1e4,2e6),2),"breakpoint":random.choice([{"type":"natural"},{"type":"fixed","amount":round(random.uniform(1e5,2e7),2)}]),"period_fraction":random.choice([1,0.5,round(random.uniform(0.05,1),4)])}
    elif k=="cam_reconciliation":
        inp={"year":2026,"pro_rata_share":round(random.uniform(0.001,1),5),"expenses":[{"category":f"c{i}","amount":round(random.uniform(0,1e6),2),"controllable":random.random()<0.6,"recoverable":random.random()<0.85,"variable":random.random()<0.4} for i in range(random.randint(1,8))],"estimates_paid":round(random.uniform(0,2e5),2)}
        if random.random()<0.6: inp["gross_up"]={"actual_occupancy":round(random.uniform(0.3,1),3),"target_occupancy":random.choice([0.9,0.95,1])}
        if random.random()<0.6:
            m=random.choice(["compounding_from_base","simple_from_base","year_over_year"]); inp["cap"]={"method":m,"rate":round(random.uniform(0,0.08),3),"reference_amount":round(random.uniform(0,2e5),2),"years_elapsed":random.randint(0,10)}
        inp["structure"]=random.choice([{"type":"net"},{"type":"base_year","base_year_expenses":round(random.uniform(0,3e6),2)},{"type":"expense_stop","stop_amount":round(random.uniform(0,3e6),2)}])
        if random.random()<0.5:
            inp["admin_fee"]={"rate":round(random.uniform(0,0.2),3),"applied":random.choice(["before_cap","after_cap"]),"capped":random.random()<0.5}
            for e in inp["expenses"]: e["admin_fee_applies"]=random.random()<0.7
        if random.random()<0.4:
            o={}
            if random.random()<0.3: o["period_start_date"]="2026-04-01"; o["period_end_date"]="2027-03-31"
            ps,pe=(o.get("period_start_date","2026-01-01"),o.get("period_end_date","2026-12-31"))
            if random.random()<0.7: o["move_in_date"]=random.choice([ps,"2026-07-01","2026-11-15","2026-04-01"])
            if random.random()<0.5: o["move_out_date"]=random.choice([pe,"2026-12-15","2026-08-31"])
            inp["occupancy"]=o
    elif k=="debt_sizing":
        inp={"noi":round(random.uniform(1e4,5e7),2),"value":round(random.uniform(1e5,8e8),2),"rate_annual":round(random.uniform(0,0.12),4),"amortization_years":random.choice([0,20,25,30]),"round_down_to":random.choice([1,1000,10000])}
        for c,v in [("max_ltv",round(random.uniform(0.3,0.9),3)),("min_dscr",round(random.uniform(1,1.6),2)),("min_debt_yield",round(random.uniform(0.06,0.14),3))]:
            if random.random()<0.7: inp[c]=v
        if not any(c in inp for c in ("max_ltv","min_dscr","min_debt_yield")): inp["min_dscr"]=1.25
        if random.random()<0.3: inp["existing_loan_balance"]=round(random.uniform(1e5,5e8),2)
        if random.random()<0.4:
            st={}
            if random.random()<0.7: st["noi_shocks"]=[round(random.uniform(-0.5,0.2),3) for _ in range(random.randint(1,4))]
            if random.random()<0.6: st["rate_shocks"]=[round(random.uniform(-inp["rate_annual"],0.04),4) for _ in range(random.randint(1,3))]
            if random.random()<0.5: st["value_shocks"]=[round(random.uniform(-0.4,0.1),3) for _ in range(random.randint(1,3))]
            if random.random()<0.3: st["value_moves_with_noi"]=True
            if not st or st=={"value_moves_with_noi":True}: st["noi_shocks"]=[-0.1]
            inp["stress"]=st
    elif k=="walt": inp={"as_of":"2026-06-30","weight_by":random.choice(["area","rent"]),"leases":[{"expiration_date":f"20{random.randint(24,45)}-{random.randint(1,12):02d}-{random.randint(1,28):02d}","area_sf":round(random.uniform(500,1e5),0),"annual_rent":round(random.uniform(1e4,5e6),2)} for _ in range(random.randint(1,20))]}
    elif k=="lease_remeasurement_asc842":
        n=random.randint(1,120); periods=sorted(random.sample(range(1,n+1),random.randint(1,n)))
        inp={"classification":random.choice(["operating","finance"]),"payments":[{"period":m,"amount":round(random.uniform(0,5e4),2)} for m in periods],
             "payment_timing":random.choice(["begin","end"]),"discount_rate_annual":random.choice([0,round(random.uniform(0.005,0.15),4)]),
             "periods_per_year":random.choice([12,12,4,1]),"discount_rate_updated":random.random()<0.5,"liability_before":round(random.uniform(0,3e6),2),
             "rou_asset_before":round(random.uniform(0,3e6),2),
             "event":random.choice(["modification_extend_term","modification_shorten_term","modification_change_in_payments","reassessment_of_term_or_option","contingency_resolved","residual_value_guarantee_change","index_or_rate_change"])}
        if random.random()<0.3: inp["remaining_periods"]=n
    elif k=="prepayment_and_defeasance":
        n=random.randint(1,240)
        inp={"balance":round(random.uniform(1e5,1e8),2),"note_rate_annual":round(random.uniform(0,0.12),4),"remaining_term_months":n,
             "amortization_months":random.choice([0,n,n+random.randint(0,420)]),"accrued_interest":random.choice([0,round(random.uniform(0,2e5),2)])}
        kind=random.choice(["yield_maintenance","step_down","fixed_pct","defeasance"])
        conv=random.choice(["monthly","semiannual"])
        if kind=="yield_maintenance":
            inp["prepayment"]={"type":kind,"treasury_rate_annual":round(random.uniform(0,0.08),4),"spread_annual":random.choice([0,0.005,round(random.uniform(0,0.02),4)]),
                               "minimum_pct":random.choice([0,0.01,round(random.uniform(0,0.03),4)]),"basis":random.choice(["pv_of_payments","rate_differential"]),"discount_convention":conv}
        elif kind=="step_down":
            steps=sorted(random.sample(range(1,121),random.randint(1,6)))
            inp["prepayment"]={"type":kind,"loan_month":random.randint(1,130),"schedule":[{"through_month":m,"pct":round(random.uniform(0,0.06),4)} for m in steps]}
        elif kind=="fixed_pct": inp["prepayment"]={"type":kind,"pct":round(random.uniform(0,0.05),4)}
        else:
            if random.random()<0.5: ry=round(random.uniform(0,0.1),4)
            else:
                months=sorted(random.sample(range(1,n+1),random.randint(1,min(n,5)))); ry=[{"months":m,"rate":round(random.uniform(0,0.1),4)} for m in months]
            inp["prepayment"]={"type":kind,"replacement_yield":ry,"costs":round(random.uniform(0,2e5),2),"discount_convention":conv}
    elif k=="lease_vs_own":
        h=random.randint(1,30)
        rent=random.choice([{"type":"schedule","annual_rent":[round(random.uniform(0,2e6),2) for _ in range(h if random.random()<0.9 else random.randint(1,50))]},{"type":"escalating","base_rent_annual":round(random.uniform(0,2e6),2),"escalation_rate_annual":round(random.uniform(0,0.06),4)}])
        price=round(random.uniform(1e5,5e7),2)
        own={"purchase_price":price,"closing_costs":round(random.uniform(0,5e5),2),"operating_expenses_annual":round(random.uniform(0,5e5),2),"capex_reserve_annual":round(random.uniform(0,1e5),2),"property_taxes_annual":round(random.uniform(0,5e5),2),"insurance_annual":round(random.uniform(0,1e5),2),"expense_growth_rate_annual":round(random.uniform(0,0.05),4),
             "residual":random.choice([{"type":"value","amount":round(random.uniform(0,6e7),2)},{"type":"exit_cap","cap_rate":round(random.uniform(0.04,0.12),4),"stabilized_noi":round(random.uniform(0,4e6),2)}]),"selling_costs_rate":round(random.uniform(0,0.08),4)}
        if random.random()<0.75: own["loan"]={"amount":round(random.uniform(0,price),2),"rate_annual":random.choice([0,round(random.uniform(0.02,0.1),4)]),"amortization_years":random.choice([0,10,20,25,30])}
        if random.random()<0.5: own["tax"]={"marginal_tax_rate":round(random.uniform(0,0.45),3),"depreciation_life_years":random.choice([27,39,random.randint(1,60)]),"land_share":round(random.uniform(0,0.5),3),"rent_deductible":random.random()<0.8,"interest_deductible":random.random()<0.8,"depreciation_deductible":random.random()<0.8}
        inp={"horizon_years":h,"discount_rate_annual":round(random.uniform(0,0.15),4),"lease":{"rent":rent,"free_rent_months":random.randint(0,15),"operating_expenses_annual":round(random.uniform(0,5e5),2),"expense_growth_rate_annual":round(random.uniform(0,0.05),4),"upfront_costs":round(random.uniform(0,1e6),2)},"own":own}
    elif k=="renew_vs_relocate":
        h=random.randint(1,180)
        def case():
            s=sched(); s.pop("term_months"); s["abated_months"]=sorted(random.sample(range(1,h+1),min(h,random.randint(0,12)))); return s
        inp={"horizon_months":h,"discount_rate_annual":round(random.uniform(0,0.15),4),"current_rent_monthly":round(random.uniform(0,1e5),2),
             "renew":{"schedule":case(),"ti_cost":round(random.uniform(0,1e6),2),"ti_allowance":round(random.uniform(0,1e6),2),"renewal_fee":round(random.uniform(0,5e4),2)},
             "relocate":{"schedule":case(),"buildout_cost":round(random.uniform(0,3e6),2),"ti_allowance":round(random.uniform(0,3e6),2),"moving_cost":round(random.uniform(0,5e5),2),"downtime_months":random.randint(0,6),"downtime_cost_monthly":round(random.uniform(0,2e5),2),"overlap_months":random.randint(0,6),"termination_cost":round(random.uniform(0,5e5),2),"disruption_cost":round(random.uniform(0,5e5),2)}}
    elif k=="hotel_metrics":
        nights=random.choice([1,7,28,30,31,90,365]); rooms=random.randint(1,800); avail=rooms*nights; ooo=random.randint(0,min(avail,50)) if random.random()<0.3 else 0
        inp={"nights":nights,"rooms":rooms,"rooms_out_of_order":ooo,"rooms_sold":random.randint(0,max(0,avail-ooo)+ (5 if random.random()<0.05 else 0)),"room_revenue":round(random.uniform(0,5e7),2),"fb_revenue":round(random.uniform(0,2e7),2),"other_revenue":round(random.uniform(0,5e6),2),"departmental_expenses":round(random.uniform(0,3e7),2),"undistributed_expenses":round(random.uniform(0,2e7),2),"management_fee_rate":round(random.uniform(0,0.05),4),"management_fee_fixed":round(random.uniform(0,5e5),2),"non_operating_expenses":round(random.uniform(0,5e6),2),"ffe_reserve_rate":random.choice([0,0.03,0.04,0.05])}
    elif k=="npv":
        # Long series at a rate near -100% underflow (1 + r)^t to 0: both SDKs must agree (inf/nan).
        long=random.random()<0.15
        inp={"cash_flows":[round(random.uniform(-1e6,1e6),2) for _ in range(random.randint(80,240) if long else random.randint(2,30))],"rate":-0.9999 if long and random.random()<0.5 else round(random.uniform(-0.5,0.5),4)}
    else:
        n=random.randint(80,240) if random.random()<0.15 else random.randint(2,40); inp={"cash_flows":[-round(random.uniform(1e5,1e7),2)]+[round(random.uniform(-2e5,2e6),2) for _ in range(n-1)],"periods_per_year":random.choice([1,4,12])}
    cases.append({"calc":k,"input":inp})
    # rules: random tax years and notice dates (including weekends and holidays)
    y=random.randint(2000,2100)
    rinp={"tax_year":y}
    if random.random()<0.85:
        from datetime import date as _d, timedelta as _t
        rinp["notice_delivered_date"]=(_d(y,1,1)+_t(days=random.randint(0,364))).isoformat()
    cases.append({"rule":"tx_property_tax_protest_deadline","input":rinp})
# document tools and fact_validate: their own random stream, so the cases above stay as they were
sys.path.insert(0, __import__("os").path.dirname(__file__))
from gen_docs import doc_cases, round2_cases
cases.extend(doc_cases(int(sys.argv[1]), int(sys.argv[2])))
# valuation calculators: also their own random stream
from gen_valuation import valuation_cases
cases.extend(valuation_cases(int(sys.argv[1]), int(sys.argv[2])))
# draft rules packs: also their own random stream
from gen_drafts import draft_cases
cases.extend(draft_cases(int(sys.argv[1]), int(sys.argv[2])))
# operations calculators and the lease unit option: their own stream too
from gen_operations import operation_cases
cases.extend(operation_cases(int(sys.argv[1]), int(sys.argv[2]) // 2, sched))
# lease_comp_validate: its own stream as well
from gen_comps import comp_cases
cases.extend(comp_cases(int(sys.argv[1]), int(sys.argv[2])))
# round-2 document tools (clauses, statements, use conflicts, fact packages): their own stream
cases.extend(round2_cases(int(sys.argv[1]), int(sys.argv[2]) // 2))
json.dump(cases,open(sys.argv[3],"w"))
