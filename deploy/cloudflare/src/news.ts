/**
 * Short, true lines the account page shows under "What's new" and "Hosted regions". Each
 * WHATS_NEW entry names the CHANGELOG.md phrase it summarises; a test checks that the phrase is
 * in the changelog, so the page cannot announce something the changelog does not record.
 *
 * HOSTING_NOTE is generated from site/_data/hosted.json (scripts/site/gen-hosted.ts), so it names what the
 * hosted pack serves.
 */
import { HOSTED_NOTE } from "./hosted_note.ts";

export const HOSTING_NOTE = HOSTED_NOTE;

export const WHATS_NEW: { text: string; changelog: string }[] = [
  {
    text: "Texas registry grows to eighteen counties: Bell and Johnson join, each with roll years 2024 to 2026.",
    changelog: "eighteen hosted counties",
  },
  {
    text: "Six new hosted regions: New York City (all five boroughs), Los Angeles County, San Francisco, the City of Boston, Denver and Connecticut. Los Angeles County and San Francisco files carry no owner names; the City of Boston is loaded without the rest of Suffolk County.",
    changelog: "six new hosted regions",
  },
  {
    text: "Texas registry grows to sixteen counties: Cameron, Nueces, Galveston, Jefferson, Brazos, Midland, Ector, Grayson, Guadalupe and Kaufman join, with several roll years in Brazos, Nueces, Galveston, Kaufman, Jefferson and Guadalupe.",
    changelog: "sixteen hosted counties",
  },
  {
    text: "Reports are open (7 November 2026): call report_create, or POST /v1/reports, to get an XLSX, PDF or ICS file built by code from a tool result. Links work 24 hours; 3 a month free per IP address, 50 on Pro, 1,000 on Team.",
    changelog: "reports are open",
  },
  {
    text: "Searches, resolves and owner lookups that find nothing are no longer counted as registry lookups, on every plan (up to an hourly limit), and the answer says counted: false.",
    changelog: "registry answers that find nothing are not counted",
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
