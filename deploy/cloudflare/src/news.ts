/**
 * Short, true lines the account page shows under "What's new" and "Hosted regions". Each
 * WHATS_NEW entry names the CHANGELOG.md phrase it summarises; a test checks that the phrase is
 * in the changelog, so the page cannot announce something the changelog does not record.
 */
export const HOSTING_NOTE = "Texas hosting opens with this release.";

export const WHATS_NEW: { text: string; changelog: string }[] = [
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
