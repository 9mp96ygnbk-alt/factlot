# Template reply to early-access emails

> **TEMPLATE FOR THE FOUNDER.** Send from `contact@factlot.com` within one working day of an email whose subject starts "FactLot hosted registry early access". Personalise the first sentence; do not send it unchanged. The three questions are the point: they tell you whether this is a design-partner conversation or a "keep in touch".
>
> Do not state a price, a date or a coverage commitment that is not in the repository. Pricing is a hypothesis in `docs/business-model.md` and is not published. The public support channel is GitHub Discussions on the repository.

**Subject:** Re: FactLot hosted registry early access

```
Hi [first name],

Thanks for writing, and for [one specific thing from their email: their use case, metro, or tool].

Where things stand, so there are no surprises: the hosted registry is not public yet. What exists today is open source on GitHub (github.com/9mp96ygnbk-alt/factlot): the calculators, the IDs, the fact schema and a local MCP server, which you can run now with no key. The registry data itself (public-record parcels and registered entities, each fact citing its source file) is loaded for Texas's five largest counties, NYC, LA, SF, Boston, Denver, Charlotte, Minneapolis and DC, but nobody outside can query it through a hosted endpoint yet. Early-access teams will help decide how it is priced.

Three questions, so I can tell whether what we have fits:

1. What is the task your agent does (or you want it to do) that needs parcel, owner or entity data, and which metros or counties does it cover?
2. Roughly how many lookups would that be in a month, and what do you use today (a vendor, a county site, a spreadsheet)? If a vendor's licence stops your agent from using its data, which one?
3. How did you hear about FactLot?

If it looks like a fit, I would like to set you up as a design partner: you run the open-source tools in a real agent for two weeks, tell me where they fail or the data is missing, and we talk for 30 minutes about what you would need to rely on it. In return you shape which metros and sources I verify next and you get first access to the hosted registry when it opens. No cost for the trial.

If it is not a fit yet, that is fine: tell me what is missing and I will tell you honestly whether it is on the list. Questions that others might share are welcome in GitHub Discussions on the repository; please do not send confidential leases or personal data by email.

Best,
[Name]
FactLot · contact@factlot.com
```

## After sending

- Record in a private notes file: date, company type, metros, monthly lookups, current vendor, how they heard. These feed the design-partner count and the week-6 decision gate in `docs/customer-discovery.md`.
- If they do not answer in a week, send one short follow-up and then stop.
- If their answers show a metro the registry does not cover, say so in the next reply and note it as demand for that metro.
