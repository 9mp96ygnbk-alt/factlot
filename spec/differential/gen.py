"""Generate random calculator inputs for the TypeScript/Python differential test.

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
    k=random.choice(["rent_schedule","net_effective_rent","compare_proposals","percentage_rent","cam_reconciliation","debt_sizing","walt","npv","irr"])
    if k=="rent_schedule": inp=sched()
    elif k=="net_effective_rent": inp={"schedule":sched(),"ti_allowance_psf":round(random.uniform(0,150),2),"leasing_commissions":round(random.uniform(0,500000),2),"discount_rate_annual":round(random.uniform(0,0.15),4)}
    elif k=="compare_proposals": inp={"perspective":random.choice(["tenant","landlord"]),"discount_rate_annual":round(random.uniform(0,0.15),4),"proposals":[{"name":f"P{i}","schedule":sched(),"ti_allowance_psf":round(random.uniform(0,100),2),"additional_costs_psf_annual":round(random.uniform(0,20),2),"tenant_upfront_costs":round(random.uniform(0,1e5),2),"leasing_commissions":round(random.uniform(0,1e5),2)} for i in range(random.randint(2,5))]}
    elif k=="percentage_rent": inp={"gross_sales":round(random.uniform(0,2e7),2),"sales_exclusions":round(random.uniform(0,1e6),2),"rate":round(random.uniform(0.01,0.12),4),"base_rent_annual":round(random.uniform(1e4,2e6),2),"breakpoint":random.choice([{"type":"natural"},{"type":"fixed","amount":round(random.uniform(1e5,2e7),2)}]),"period_fraction":random.choice([1,0.5,round(random.uniform(0.05,1),4)])}
    elif k=="cam_reconciliation":
        inp={"year":2026,"pro_rata_share":round(random.uniform(0.001,1),5),"expenses":[{"category":f"c{i}","amount":round(random.uniform(0,1e6),2),"controllable":random.random()<0.6,"recoverable":random.random()<0.85,"variable":random.random()<0.4} for i in range(random.randint(1,8))],"estimates_paid":round(random.uniform(0,2e5),2)}
        if random.random()<0.6: inp["gross_up"]={"actual_occupancy":round(random.uniform(0.3,1),3),"target_occupancy":random.choice([0.9,0.95,1])}
        if random.random()<0.6:
            m=random.choice(["compounding_from_base","simple_from_base","year_over_year"]); inp["cap"]={"method":m,"rate":round(random.uniform(0,0.08),3),"reference_amount":round(random.uniform(0,2e5),2),"years_elapsed":random.randint(0,10)}
        inp["structure"]=random.choice([{"type":"net"},{"type":"base_year","base_year_expenses":round(random.uniform(0,3e6),2)},{"type":"expense_stop","stop_amount":round(random.uniform(0,3e6),2)}])
    elif k=="debt_sizing":
        inp={"noi":round(random.uniform(1e4,5e7),2),"value":round(random.uniform(1e5,8e8),2),"rate_annual":round(random.uniform(0,0.12),4),"amortization_years":random.choice([0,20,25,30]),"round_down_to":random.choice([1,1000,10000])}
        for c,v in [("max_ltv",round(random.uniform(0.3,0.9),3)),("min_dscr",round(random.uniform(1,1.6),2)),("min_debt_yield",round(random.uniform(0.06,0.14),3))]:
            if random.random()<0.7: inp[c]=v
        if not any(c in inp for c in ("max_ltv","min_dscr","min_debt_yield")): inp["min_dscr"]=1.25
    elif k=="walt": inp={"as_of":"2026-06-30","weight_by":random.choice(["area","rent"]),"leases":[{"expiration_date":f"20{random.randint(24,45)}-{random.randint(1,12):02d}-{random.randint(1,28):02d}","area_sf":round(random.uniform(500,1e5),0),"annual_rent":round(random.uniform(1e4,5e6),2)} for _ in range(random.randint(1,20))]}
    elif k=="npv": inp={"cash_flows":[round(random.uniform(-1e6,1e6),2) for _ in range(random.randint(2,30))],"rate":round(random.uniform(-0.5,0.5),4)}
    else:
        n=random.randint(2,40); inp={"cash_flows":[-round(random.uniform(1e5,1e7),2)]+[round(random.uniform(-2e5,2e6),2) for _ in range(n-1)],"periods_per_year":random.choice([1,4,12])}
    cases.append({"calc":k,"input":inp})
    # rules: random tax years and notice dates (including weekends and holidays)
    y=random.randint(2000,2100)
    rinp={"tax_year":y}
    if random.random()<0.85:
        from datetime import date as _d, timedelta as _t
        rinp["notice_delivered_date"]=(_d(y,1,1)+_t(days=random.randint(0,364))).isoformat()
    cases.append({"rule":"tx_property_tax_protest_deadline","input":rinp})
json.dump(cases,open(sys.argv[3],"w"))
