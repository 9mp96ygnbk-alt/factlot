/**
 * Short, true lines the account page shows under "What's new" and "Hosted regions". Each
 * WHATS_NEW entry names the CHANGELOG.md phrase it summarises; a test checks that the phrase is
 * in the changelog, so the page cannot announce something the changelog does not record.
 */
export const HOSTING_NOTE =
  "Texas is hosted: Harris, Dallas, Travis, Collin, Denton and Williamson counties. Tarrant County is not served while the publisher's terms for AI use are unclear.";

export const WHATS_NEW: { text: string; changelog: string }[] = [
  {
    text: "Reports are open (7 November 2026): call report_create, or POST /v1/reports, to get an XLSX, PDF or ICS file built by code from a tool result. Links work 24 hours; 3 a month free per IP address, 50 on Pro, 1,000 on Team.",
    changelog: "reports are open",
  },
  {
    text: "Texas registry lookups: six counties with value history and equity candidates.",
    changelog: "six Texas counties",
  },
  {
    text: "Only answered registry lookups count: coverage checks, misses and input errors are free.",
    changelog: "charged only when answered",
  },
  {
    text: "Lost your key? Recover access here with the email you paid with.",
    changelog: "email recovery",
  },
  {
    text: "Agents can buy and collect a key themselves with a claim URL.",
    changelog: "claim_url",
  },
  {
    text: "Your usage by day, tool and region, here and from the account_usage tool.",
    changelog: "account_usage",
  },
];
