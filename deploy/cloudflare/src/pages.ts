/**
 * The HTML pages the Worker serves: onboarding after checkout, /account, recovery and messages.
 *
 * They share the site's look: the served /styles.css (tokens, header, footer, dark mode) plus a
 * small nonce'd style block for the parts the landing page does not have (steps, copy buttons,
 * forms). Every interpolated value is escaped. Scripts run only with the response's nonce and
 * only do two things: copy a block to the clipboard and call GET /v1/account for "Test your key".
 * Forms post to the Worker; a key never travels in a URL.
 */
import type { HostedRegion } from "./account-tools.ts";
import type { AccountSummary } from "./billing.ts";
import { CHANGELOG_URL, CONTACT, REPO } from "./contact.ts";
import { escapeHtml } from "./html.ts";
import {
  CONSENT_FOOTNOTE,
  freeConsentText,
  paidConsentText,
} from "./lifecycle-copy.ts";
import { base64url } from "./keys.ts";
import { HOSTING_NOTE, WHATS_NEW } from "./news.ts";
import type { Connection } from "./oauth.ts";
import { setupGuide, type Snippet } from "./onboarding.ts";
import {
  ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY,
  ANONYMOUS_REQUESTS_PER_MINUTE,
  FREE_KEY_ADDRESS_LOOKUPS_PER_DAY,
  PLANS,
  QUOTA_RULES,
  REPORTS_PER_MONTH,
  priceText,
  type Plan,
} from "./plans.ts";
import type { UsageSummary } from "./types.ts";

export { escapeHtml };

/** The one-line counting rule on the onboarding and account pages. */
export const LOOKUP_RULE =
  "A lookup is one answered call to a registry tool; coverage checks, misses and input errors are free.";

export const REPORT_RULE =
  "A report is one document report_create builds and stores; input errors are free, and reports never count as lookups.";

const DEFAULT_SITE = "https://factlot.com";
const DEFAULT_API = "https://api.factlot.com";
const trim = (u: string) => u.replace(/\/$/, "");

const EXTRA_CSS = `
.flow{padding:2.25rem 0 3rem;border-bottom:0;background:var(--bg)}
.narrow{max-width:46rem}
.flow h1{margin-bottom:1rem}
.lead{font-size:1.1rem;color:var(--muted);max-width:60ch}
.flow section.step{margin:2.5rem 0 0;padding:0;border:0;background:none}
.step>h2{font-size:1.35rem;display:flex;gap:.6rem;align-items:baseline;margin-bottom:.6rem}
.step>h2 .n{color:var(--muted);font-size:1rem;font-variant-numeric:tabular-nums}
.block{position:relative;margin:.5rem 0 1rem}
.block .label{margin:0 0 .25rem;font-size:.85rem;color:var(--muted)}
.block pre{margin:0;padding-right:4.75rem;white-space:pre-wrap;word-break:break-all}
.block.key pre{border:2px solid var(--accent);font-size:1rem}
.copy{position:absolute;right:.5rem;bottom:.5rem;font:inherit;font-size:.8rem;padding:.25rem .6rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);cursor:pointer}
.notice{border-left:3px solid var(--accent);background:var(--bg-alt);padding:.75rem 1rem;border-radius:0 6px 6px 0;margin:0 0 1.5rem}
.notice.warn{border-left-color:var(--focus)}
.notice p:last-child{margin:0}
.warn{color:var(--focus)}
details.client{border:1px solid var(--border);border-radius:8px;margin:.5rem 0;padding:0 1rem}
details.client>summary{cursor:pointer;padding:.8rem 0;font-weight:600}
details.client[open]>summary{border-bottom:1px solid var(--border);margin-bottom:.75rem}
details.client ol{padding-left:1.25rem}
dl.facts{display:grid;grid-template-columns:minmax(8.5rem,max-content) 1fr;gap:.45rem 1.25rem;margin:0 0 1rem}
dl.facts dt{color:var(--muted)}dl.facts dd{margin:0}
label{display:block;font-weight:600;margin:0 0 .35rem}
input[type=password],input[type=email],input[type=text]{width:100%;font:1rem ui-monospace,SFMono-Regular,Menlo,monospace;padding:.65rem .75rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)}
input[type=email]{font-family:inherit}
form{margin:0}
.buttons{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;margin:1rem 0}
button.button{font:inherit;font-weight:600;cursor:pointer;background:transparent}
button.button.primary{background:var(--accent);color:var(--accent-text)}
button.link{font:inherit;background:none;border:0;padding:0;color:var(--accent);text-decoration:underline;cursor:pointer}
progress{width:100%;height:.7rem;accent-color:var(--accent)}
.out{min-height:1.5rem}
.spark{display:block;width:100%;height:56px;color:var(--accent)}
table.keys td,table.keys th{padding-right:1rem}
table.keys form{display:inline}
@media (max-width:40rem){dl.facts{grid-template-columns:1fr;gap:.1rem}dl.facts dd{margin-bottom:.6rem}table.keys td[data-label]::before{content:attr(data-label) ": ";color:var(--muted)}}
`;

const COPY_JS = `document.querySelectorAll("button.copy").forEach(function(b){b.addEventListener("click",function(){var t=document.getElementById(b.getAttribute("data-copy"));if(!t)return;var done=function(m){b.textContent=m;setTimeout(function(){b.textContent="Copy"},2000)};if(navigator.clipboard){navigator.clipboard.writeText(t.textContent).then(function(){done("Copied")},function(){done("Select and copy")})}else done("Select and copy")})});`;

function testJs(api: string): string {
  return `(function(){var API=${JSON.stringify(api).replaceAll("<", "\\u003c")};var f=document.getElementById("test");if(!f)return;f.addEventListener("submit",function(e){e.preventDefault();var out=document.getElementById("test-out");var k=document.getElementById("test-key").value.trim();out.className="out";out.textContent="Checking…";fetch(API+"/v1/account",{headers:{authorization:"Bearer "+k}}).then(function(r){return r.json().then(function(j){if(!r.ok){out.className="out warn";out.textContent=(j&&j.message?j.message:"HTTP "+r.status)+(r.status===401?" A new key can take a minute to activate: try again shortly.":"");return}var q=j.registry_lookups;out.textContent="Works. "+j.plan_name+": "+j.requests_per_minute.toLocaleString("en-US")+" requests a minute; "+q.used.toLocaleString("en-US")+" of "+q.limit.toLocaleString("en-US")+" registry lookups used this month, resets "+q.resets_at.slice(0,10)+"."})}).catch(function(){out.className="out warn";out.textContent="Could not reach "+API+". Check your connection and try again."})})})();`;
}

export interface PageOptions {
  status?: number;
  /** CSP form-action sources. */
  formAction?: string;
  site?: string;
  /** Adds the copy-button script. */
  copy?: boolean;
  /** Adds the "Test your key" script, which may call this API origin. */
  testApi?: string;
}

export function page(
  title: string,
  body: string,
  o: PageOptions = {},
): Response {
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const site = escapeHtml(trim(o.site ?? DEFAULT_SITE));
  const scripts = [o.copy ? COPY_JS : "", o.testApi ? testJs(o.testApi) : ""]
    .filter(Boolean)
    .join("\n");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="robots" content="noindex"><title>${escapeHtml(title)} · FactLot</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><style nonce="${nonce}">${EXTRA_CSS}</style></head>
<body><a class="skip" href="#main">Skip to content</a>
<header class="site-header"><div class="wrap row"><a class="brand" href="${site}/" aria-label="FactLot home">FactLot</a><nav aria-label="Site"><ul><li><a href="${site}/pricing/">Pricing</a></li><li><a href="${site}/account">Account</a></li><li><a href="mailto:${CONTACT}">Help</a></li></ul></nav></div></header>
<main id="main"><section class="flow"><div class="wrap narrow">
${body}
</div></section></main>
<footer class="site-footer"><div class="wrap"><p><a href="${REPO}">GitHub</a> · <a href="mailto:${CONTACT}">${CONTACT}</a> · <a href="${site}/privacy">Privacy</a> · <a href="${site}/terms">Terms</a></p></div></footer>
${scripts ? `<script nonce="${nonce}">${scripts}</script>` : ""}
</body></html>`;
  const csp = [
    "default-src 'none'",
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self'",
    `script-src 'nonce-${nonce}'`,
    `connect-src ${o.testApi ? trim(o.testApi) : "'none'"}`,
    `form-action ${o.formAction ?? "'none'"}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join("; ");
  return new Response(html, {
    status: o.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-security-policy": csp,
    },
  });
}

function block(id: string, label: string, code: string, cls = ""): string {
  return `<div class="block${cls ? ` ${cls}` : ""}">${label ? `<p class="label">${escapeHtml(label)}</p>` : ""}<pre id="${escapeHtml(id)}"><code>${escapeHtml(code)}</code></pre><button type="button" class="copy" data-copy="${escapeHtml(id)}">Copy</button></div>`;
}

export function notice(text: string, warn = false, title?: string): string {
  return `<div class="notice${warn ? " warn" : ""}" role="status">${title ? `<p><strong>${escapeHtml(title)}</strong></p>` : ""}<p>${escapeHtml(text)}</p></div>`;
}

/** Inline code in a sentence: `x` becomes <code>x</code>; the rest is escaped. */
function prose(s: string): string {
  return escapeHtml(s).replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function messagePage(
  status: number,
  title: string,
  message: string,
  o: { site?: string; next?: { href: string; label: string } } = {},
): Response {
  const site = trim(o.site ?? DEFAULT_SITE);
  return page(
    title,
    `<h1>${escapeHtml(title)}</h1>
<p class="lead">${escapeHtml(message)}</p>
<div class="buttons">${o.next ? `<a class="button primary" href="${escapeHtml(o.next.href)}">${escapeHtml(o.next.label)}</a>` : ""}<a class="button" href="${escapeHtml(site)}/">factlot.com</a></div>
<p class="small">Questions: <a href="mailto:${CONTACT}">${CONTACT}</a> or <a href="${REPO}/discussions">GitHub Discussions</a>.</p>`,
    { status, site },
  );
}

/** "factlot.com/account" for display, from the site origin. */
const accountText = (site: string) =>
  `${site.replace(/^https?:\/\//, "").replace(/\/$/, "")}/account`;

export interface OnboardingOptions {
  api?: string;
  site?: string;
  plan?: Plan;
  /** The key, on the one page that reveals it. */
  key?: string;
  /** The page heading (default: "Welcome to <plan>" with a key, "Set up <plan>" without). */
  title?: string;
  /** Shown above the steps (for example: the agent already collected the key). */
  notice?: { title?: string; text: string; warn?: boolean };
  status?: number;
  /** Whether the hosted API has a model (the model-backed tools answer). */
  model?: boolean;
  /** A link back to what the buyer was looking at before checkout. */
  back?: { href: string; label: string };
  /** Shows the optional-email box for this checkout session (lifecycle emails on, key shown now). */
  consent?: { sessionId: string };
}

/**
 * The page after checkout (and after a recovery or a new key): the key once, then setup for each
 * client, a live key test, and what the plan includes. Without `key` it is the same guide with
 * placeholders and a recovery link.
 */
export function onboardingPage(o: OnboardingOptions): Response {
  const api = trim(o.api ?? DEFAULT_API);
  const site = trim(o.site ?? DEFAULT_SITE);
  const g = setupGuide({
    api,
    site,
    plan: o.plan,
    key: o.key,
    placeholder: "<your key>",
    model: o.model,
  });
  const plan = o.plan;
  const h1 = o.title ?? (o.key && plan ? `Welcome to ${plan.name}` : g.title);
  const keyStep = o.key
    ? `${block("key", "", o.key, "key")}
<p>This is your API key. It is shown <strong>once</strong>: copy it into a password manager or your agent's secret store now. FactLot keeps only a hash of it.</p>
<p class="small">Your key can take up to a minute to activate everywhere.</p>`
    : `<p>Use the key you saved when you bought: it was shown once. The snippets below say <code>&lt;your key&gt;</code> where it goes.</p>
<p><a href="${escapeHtml(site)}/account#recover">Recover access</a> if you no longer have it: we email a sign-in link to the address you paid with.</p>`;
  const clients = g.clients
    .map(
      (c, i) =>
        `<details class="client"${i === 0 ? " open" : ""}><summary>${escapeHtml(c.name)}</summary><ol>${c.steps.map((s) => `<li>${prose(s)}</li>`).join("")}</ol>${c.snippets.map((s: Snippet) => block(`s-${s.id}`, s.label, s.code)).join("")}<p class="small"><a href="${escapeHtml(c.docs)}">More for ${escapeHtml(c.name)}</a></p></details>`,
    )
    .join("\n");
  const facts = plan
    ? `<dl class="facts"><dt>Requests</dt><dd>${plan.requestsPerMinute.toLocaleString("en-US")} a minute per key</dd><dt>Registry lookups</dt><dd>${plan.registryLookupsPerMonth.toLocaleString("en-US")} a month, shared by the plan's keys</dd><dt>Keys</dt><dd>${plan.maxKeys === 1 ? "1 key" : `Up to ${plan.maxKeys} keys`}</dd></dl>
<p>${escapeHtml(priceText(plan))}, renews monthly until cancelled; cancel any time at <a href="${escapeHtml(site)}/account">${escapeHtml(accountText(site))}</a>.</p>`
    : "";
  return page(
    h1,
    `<h1>${escapeHtml(h1)}</h1>
${o.notice ? notice(o.notice.text, o.notice.warn, o.notice.title) : ""}
${o.back ? `<p><a class="button" href="${escapeHtml(o.back.href)}">${escapeHtml(o.back.label)}</a></p>` : ""}
<p class="lead">Five steps, about five minutes. An agent can read the same guide as JSON or Markdown:</p>
${block("agent-url", "Give this URL to your agent", g.links.onboarding)}
<section class="step" aria-labelledby="h-key"><h2 id="h-key"><span class="n">1</span>Save your key</h2>
${keyStep}
</section>
<section class="step" aria-labelledby="h-connect"><h2 id="h-connect"><span class="n">2</span>Connect your client</h2>
<p>Clients that send headers use the MCP server <code>${escapeHtml(g.links.mcp)}</code> with the header <code>Authorization: Bearer &lt;key&gt;</code>. Claude (Desktop, claude.ai, mobile) and ChatGPT sign in instead: add <code>${escapeHtml(g.links.mcp)}/signin</code> as a connector and paste the key once on the sign-in page.</p>
<p>${escapeHtml(g.header_clients)}</p>
${clients}
<p class="small">${escapeHtml(g.plugin_note)}</p>
</section>
<section class="step" aria-labelledby="h-test"><h2 id="h-test"><span class="n">3</span>Test your key</h2>
<p>Try first. Ask your agent:</p>
<ul class="plain">${g.try_first.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>
<p>Or check the key itself:</p>
<form id="test" autocomplete="off"><label for="test-key">API key</label><input id="test-key" type="password" spellcheck="false" placeholder="fl_live_..." required${o.key ? ` value="${escapeHtml(o.key)}"` : ""}>
<div class="buttons"><button type="submit" class="button primary">Test my key</button></div></form>
<p id="test-out" class="out" role="status" aria-live="polite"></p>
${block("test-curl", "Or from a terminal", g.test.curl)}
</section>
<section class="step" aria-labelledby="h-extract"><h2 id="h-extract">${escapeHtml(g.extract_lease.title)}</h2>
<p>${escapeHtml(g.extract_lease.text)}</p>
</section>
<section class="step" aria-labelledby="h-reports"><h2 id="h-reports"><span class="n">4</span>${escapeHtml(g.reports.title)}</h2>
<p>${escapeHtml(g.reports.text)}</p>
<p class="small">MCP tool <code>${g.reports.mcp_tool}</code>; REST <code>${escapeHtml(g.reports.rest)}</code>.</p>
</section>
<section class="step" aria-labelledby="h-limits"><h2 id="h-limits"><span class="n">5</span>Know your limits</h2>
${facts}
<ul class="plain"><li>${escapeHtml(LOOKUP_RULE)}</li><li>${escapeHtml(QUOTA_RULES.at_cap)}</li><li>Calculators, IDs, documents and rules tools never count.</li><li>${escapeHtml(REPORT_RULE)}</li></ul>
<div class="buttons"><a class="button primary" href="${escapeHtml(site)}/account">Manage billing / cancel</a></div>
<p class="small">Questions: <a href="mailto:${CONTACT}">${CONTACT}</a>${plan?.id === "team" ? " (priority support)" : ""}. What changed lately: <a href="${CHANGELOG_URL}">changelog</a>.</p>
</section>${o.consent ? consentSection(o.consent.sessionId) : ""}`,
    {
      status: o.status,
      site,
      copy: true,
      testApi: api,
      formAction: o.consent ? "'self'" : undefined,
    },
  );
}

/** The unticked box after checkout; it posts the checkout session so the choice is tied to the purchase. */
function consentSection(sessionId: string): string {
  return `<section class="step" aria-labelledby="h-optional"><h2 id="h-optional">Optional emails</h2>
<form method="post" action="/account/lifecycle"><input type="hidden" name="session_id" value="${escapeHtml(sessionId)}">
<p><label><input type="checkbox" name="lifecycle_emails" value="1"> ${escapeHtml(paidConsentText())}</label></p>
<p class="small">${escapeHtml(CONSENT_FOOTNOTE)}</p>
<div class="buttons"><button type="submit" class="button">Save my choice</button></div></form></section>`;
}

/** Stop the optional emails by address, no sign-in (lifecycle emails on). */
function stopSection(): string {
  return `<section class="step" id="stop" aria-labelledby="h-stop"><h2 id="h-stop">Stop optional emails</h2>
<p>Every optional email has a stop link. Or enter the address here: the emails stop at once and for good.</p>
<form method="post" action="/account/stop"><label for="stop-email">Email</label><input id="stop-email" name="email" type="email" autocomplete="email" required maxlength="254">
<div class="buttons"><button type="submit" class="button">Stop optional emails</button></div></form></section>`;
}

const ACCOUNT_FORM_ACTION = "'self' https://billing.stripe.com";

function utc(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** The status of an account in plain English, and whether it needs the customer's attention. */
export function statusText(s: AccountSummary): { text: string; warn: boolean } {
  if (s.hold === "refunded")
    return {
      text: `Inactive: the payment was refunded. Email ${CONTACT} if this is a mistake.`,
      warn: true,
    };
  if (s.hold === "disputed")
    return {
      text: `Inactive: the payment is disputed with your bank. Email ${CONTACT} to resolve it.`,
      warn: true,
    };
  if (s.paused)
    return {
      text: "Paused: payments are paused, so the key does not work. Resume them under Manage billing.",
      warn: true,
    };
  switch (s.stripe_status) {
    case "active":
    case "trialing":
      return { text: "Active", warn: false };
    case "past_due":
      return {
        text: "Active, but the last payment failed. Stripe will retry: update your card under Manage billing to keep the key working.",
        warn: true,
      };
    case "unpaid":
      return {
        text: "Inactive: payments failed and Stripe stopped retrying. Update your card under Manage billing to turn the key back on.",
        warn: true,
      };
    case "canceled":
      return {
        text: "Cancelled. The key no longer works. A new plan starts at factlot.com/pricing/.",
        warn: true,
      };
    case "incomplete":
    case "incomplete_expired":
      return {
        text: "Inactive: the first payment did not complete.",
        warn: true,
      };
    case "missing":
      return {
        text: `Inactive: Stripe has no record of this subscription. Email ${CONTACT}.`,
        warn: true,
      };
    default:
      return {
        text: `Inactive (${s.stripe_status}). Email ${CONTACT}.`,
        warn: true,
      };
  }
}

/** Whether the "Lost your key?" form can send email, and why not. */
export type RecoveryState = "on" | "no-email" | "no-secret";

export const RECOVERY_SETUP_NOTICE = `Email recovery is being set up; email ${CONTACT}.`;

function recoverSection(state: RecoveryState): string {
  const form =
    state === "on"
      ? `<form method="post" action="/account/recover"><label for="email">Email you paid with</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254">
<div class="buttons"><button type="submit" class="button">Email me a link</button></div></form>
<p class="small">The link works once, for 15 minutes, and lets you issue a new key.</p>`
      : `<p>${escapeHtml(RECOVERY_SETUP_NOTICE)}</p>`;
  return `<section class="step" id="recover" aria-labelledby="h-recover"><h2 id="h-recover">Lost your key?</h2>${form}</section>`;
}

export const FREE_KEY_SENT =
  "If that address can receive email, a link is on its way. It works once and expires in 30 minutes.";

function freeKeySection(state: RecoveryState, lifecycle = false): string {
  const form =
    state === "on"
      ? `<p>No plan needed. A free key gives you the free limits (${ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY} registry lookups a day, ${REPORTS_PER_MONTH.anonymous} reports a month, ${ANONYMOUS_REQUESTS_PER_MINUTE} requests a minute) on your own meter instead of one shared with everyone on your network.</p>
<form method="post" action="/account/free-key"><label for="free-email">Email</label><input id="free-email" name="email" type="email" autocomplete="email" required maxlength="254">
<p><label><input type="checkbox" name="accept_terms" value="1" required> I accept the <a href="https://factlot.com/terms">terms</a> and <a href="https://factlot.com/privacy">privacy policy</a>.</label></p>
${lifecycle ? `<p><label><input type="checkbox" name="lifecycle_emails" value="1"> ${escapeHtml(freeConsentText())}</label></p>\n<p class="small">${escapeHtml(CONSENT_FOOTNOTE)}</p>` : ""}
<div class="buttons"><button type="submit" class="button">Email me a free key</button></div></form>
<p class="small">${lifecycle ? "We email one link, once, unless you tick the box above." : "We email one link, once. This is not a newsletter."} A new key replaces your earlier free key.</p>
<h3>Delete my free key</h3>
<form method="post" action="/account/free-key-delete"><label for="free-delete-email">Email the key was issued to</label><input id="free-delete-email" name="email" type="email" autocomplete="email" required maxlength="254">
<div class="buttons"><button type="submit" class="button">Email me a deletion link</button></div></form>
<p class="small">If that address has a free key, we email one link that works once for 30 minutes; it deletes only after you press the button. To delete without email, send <code>DELETE /v1/keys/free</code> with the key as the bearer token.</p>`
      : `<p>${escapeHtml(RECOVERY_SETUP_NOTICE)}</p>`;
  return `<section class="step" id="free-key" aria-labelledby="h-free-key"><h2 id="h-free-key">Get a free key</h2>${form}</section>`;
}

export const FREE_KEY_DELETE_SENT =
  "If that address has a free key, a link is on its way. It works once and expires in 30 minutes. Nothing is deleted until you open it and press the button.";

export function freeKeyDeleteSentPage(): Response {
  return messagePage(202, "Check your email", FREE_KEY_DELETE_SENT);
}

export function freeKeyDeleteConfirmPage(token: string): Response {
  return page(
    "Delete my free key",
    `<h1>Delete your free key</h1>
<p class="lead">Press the button to delete your free key, any free key it replaced, and the records kept for your address. The key stops working (allow up to a minute everywhere) and this cannot be undone. This link then stops working.</p>
<form method="post" action="/account/free-key-delete/${escapeHtml(token)}"><div class="buttons"><button type="submit" class="button primary">Delete my free key</button></div></form>`,
    { formAction: "'self'" },
  );
}

export function freeKeyDeletedPage(): Response {
  return messagePage(
    200,
    "Free key deleted",
    "Your free key and the records kept for your address are deleted. You can get a new free key from the account page at any time.",
  );
}

export function freeKeySentPage(): Response {
  return messagePage(202, "Check your email", FREE_KEY_SENT);
}

export function freeKeyConfirmPage(token: string): Response {
  return page(
    "Get a free key",
    `<h1>Get your free key</h1>
<p class="lead">Press the button to create your key. It is shown once on the next page, and this link then stops working. A new key replaces any earlier free key for your address.</p>
<form method="post" action="/account/free-key/${escapeHtml(token)}"><div class="buttons"><button type="submit" class="button primary">Create my free key</button></div></form>`,
    { formAction: "'self'" },
  );
}

export function freeKeyIssuedPage(o: {
  key: string;
  replaced: boolean;
  api: string;
  site: string;
}): Response {
  const api = trim(o.api);
  return page(
    "Your free key",
    `<h1>Your free key</h1>
${o.replaced ? notice("Your earlier free key no longer works (allow a minute everywhere); this one replaces it.") : ""}
${block("key", "", o.key, "key")}
<p>This is your API key. It is shown <strong>once</strong>: copy it into a password manager or your agent's secret store now. FactLot keeps only a hash of it. It can take up to a minute to activate.</p>
<h2>Use it</h2>
<p>Send it as <code>Authorization: Bearer &lt;key&gt;</code> to the MCP server <code>${escapeHtml(api)}/mcp</code> or the REST API. Try:</p>
${block("free-curl", "From a terminal", `curl -H "Authorization: Bearer ${o.key}" ${api}/v1/plans`)}
<h2>Limits</h2>
<ul class="plain"><li>${ANONYMOUS_REQUESTS_PER_MINUTE} requests a minute and ${ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY} registry lookups a day (UTC), counted for this key. All the free keys used from one network address share at most ${FREE_KEY_ADDRESS_LOOKUPS_PER_DAY} lookups a day.</li><li>${REPORTS_PER_MONTH.anonymous} reports a month.</li><li>Paid tools and account tools need a plan: <a href="${escapeHtml(trim(o.site))}/#pricing">pricing</a>.</li></ul>`,
    { copy: true, site: o.site },
  );
}

/** The key-entry form of /account. The key travels in a POST body, never in the URL. */
export function accountFormPage(
  status = 200,
  message?: string,
  recovery: RecoveryState = "no-email",
  freeKeyOn = false,
  lifecycleOn = false,
): Response {
  return page(
    "Your FactLot account",
    `<h1>Your account</h1>
${message ? notice(message, status >= 400) : ""}
<p class="lead">Paste your API key to see your plan and usage, manage billing or cancel, and replace or add keys.</p>
<form method="post" action="/account">
<label for="key">API key</label>
<input id="key" name="key" type="password" autocomplete="off" spellcheck="false" placeholder="fl_live_..." required>
<div class="buttons"><button type="submit" class="button primary" name="action" value="view">Show my account</button></div>
</form>
${freeKeyOn ? freeKeySection(recovery, lifecycleOn) : ""}
${recoverSection(recovery)}
${lifecycleOn ? stopSection() : ""}
<p class="small">No plan yet? See <a href="https://factlot.com/pricing/">pricing</a>. Questions: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`,
    { status, formAction: ACCOUNT_FORM_ACTION },
  );
}

function actionForm(
  key: string,
  action: string,
  label: string,
  extra = "",
  style: "primary" | "plain" | "link" = "plain",
  formAction = "/account",
): string {
  const cls =
    style === "link"
      ? "link"
      : `button${style === "primary" ? " primary" : ""}`;
  return `<form method="post" action="${escapeHtml(formAction)}">${key ? `<input type="hidden" name="key" value="${escapeHtml(key)}">` : ""}${extra}<button type="submit" class="${cls}" name="action" value="${action}">${escapeHtml(label)}</button></form>`;
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

/** doc_extract_lease and report_narrative: this month's use of each allowance, or that they are off. */
function modelFacts(s: AccountSummary): string {
  const n = (x: number) => x.toLocaleString("en-US");
  const pages = s.ingest_pages;
  const narr = s.narratives;
  if (!s.model_tools.available)
    return `<code>doc_extract_lease</code> (${n(pages.limit)} pages a month) and <code>report_narrative</code> (${n(narr.limit)} a month) are not switched on yet; every other tool works without them.`;
  return `<code>doc_extract_lease</code>: ${n(pages.used)} of ${n(pages.limit)} pages used this month. <code>report_narrative</code>: ${n(narr.used)} of ${n(narr.limit)} narratives. Both reset ${escapeHtml(utc(pages.resets_at))} and never count as registry lookups.`;
}

/** The plan, status and usage rows shared by /account and the recovery page. */
function accountFacts(s: AccountSummary, receipts?: string): string {
  const st = statusText(s);
  const q = s.registry_lookups;
  const left = Math.max(0, q.limit - q.used);
  return `<dl class="facts">
<dt>Status</dt><dd${st.warn ? ' class="warn"' : ""}>${escapeHtml(st.text)}</dd>
<dt>Price</dt><dd>${escapeHtml(s.price)}, renews monthly until cancelled</dd>
${s.renewal_at ? `<dt>Renewal</dt><dd>Renews on ${escapeHtml(day(s.renewal_at))}</dd>` : ""}
${s.ends_at ? `<dt>Ends</dt><dd class="warn">Ends on ${escapeHtml(day(s.ends_at))}; it will not renew</dd>` : ""}
${receipts ? `<dt>Receipts</dt><dd>Stripe emails receipts to ${escapeHtml(receipts)}</dd>` : ""}
<dt>Rate limit</dt><dd>${s.requests_per_minute.toLocaleString("en-US")} requests a minute per key</dd>
<dt>Registry lookups</dt><dd><progress max="${q.limit}" value="${Math.min(q.used, q.limit)}" aria-label="Registry lookups used">${q.used} of ${q.limit}</progress><br>${q.used.toLocaleString("en-US")} of ${q.limit.toLocaleString("en-US")} used this month (${left.toLocaleString("en-US")} left); resets ${escapeHtml(utc(q.resets_at))}</dd>
<dt>Reports</dt><dd>${s.reports.used.toLocaleString("en-US")} of ${s.reports.limit.toLocaleString("en-US")} built this month with <code>report_create</code> (XLSX, PDF, ICS); resets ${escapeHtml(utc(s.reports.resets_at))}</dd>
<dt>Model-backed tools</dt><dd>${modelFacts(s)}</dd>
<dt>Keys</dt><dd>${s.keys.count} of ${s.keys.limit}</dd>
<dt>What counts</dt><dd>${escapeHtml(LOOKUP_RULE)} ${escapeHtml(REPORT_RULE)}</dd>
${s.payment_failed_at ? `<dt>Last failed payment</dt><dd class="warn">${escapeHtml(utc(s.payment_failed_at))}</dd>` : ""}
${s.deletes_at ? `<dt>Record deleted</dt><dd>${escapeHtml(utc(s.deletes_at))} unless the key is active again</dd>` : ""}
</dl>`;
}

/** A 30-day bar sparkline of daily lookups (SVG attributes only: no inline styles under the CSP). */
function sparkline(u: UsageSummary): string {
  const max = Math.max(1, ...u.daily.map((d) => d.lookups));
  const w = 300 / u.daily.length;
  const peak = u.daily.reduce((a, b) => (b.lookups > a.lookups ? b : a));
  const bars = u.daily
    .map((d, i) => {
      const h = d.lookups === 0 ? 1 : Math.max(2, (d.lookups / max) * 52);
      return `<rect x="${(i * w + 1).toFixed(1)}" y="${(56 - h).toFixed(1)}" width="${(w - 2).toFixed(1)}" height="${h.toFixed(1)}"${d.lookups === 0 ? ' opacity="0.3"' : ""}><title>${d.date}: ${d.lookups}</title></rect>`;
    })
    .join("");
  const label =
    u.total === 0
      ? `No registry lookups from ${u.from} to ${u.to}`
      : `${u.total} registry lookup${u.total === 1 ? "" : "s"} from ${u.from} to ${u.to}; most on ${peak.date} (${peak.lookups})`;
  return `<svg class="spark" viewBox="0 0 300 56" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(label)}" fill="currentColor">${bars}</svg>`;
}

function tally(t: Record<string, number>): string {
  const rows = Object.entries(t).sort((a, b) => b[1] - a[1]);
  return rows.length
    ? rows
        .map(
          ([k, n]) =>
            `<li><code>${escapeHtml(k)}</code> ${n.toLocaleString("en-US")}</li>`,
        )
        .join("")
    : "<li>None yet</li>";
}

export interface AccountPageOptions {
  notice?: string;
  newKey?: string;
  status?: number;
  /** Masked address Stripe sends receipts to. */
  receipts?: string;
  /** The subscription's last 30 days. */
  usage?: UsageSummary;
  /** The hosted registry's coverage, by state. */
  regions?: HostedRegion[];
  /** Apps connected to the subscription by OAuth sign-in. */
  connections?: Connection[];
  api?: string;
  /** Lifecycle emails are on: show how to stop the optional emails. */
  lifecycle?: boolean;
}

/** Connected apps (OAuth sign-ins) with a Disconnect button each. */
function connectionsSection(
  key: string,
  api: string,
  connections: Connection[],
): string {
  const rows = connections
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.client)}</td><td data-label="Connected">${escapeHtml(c.connected_at.slice(0, 10))}</td><td data-label="Last used">${c.last_used_at ? escapeHtml(utc(c.last_used_at)) : "Not yet"}</td><td>${actionForm(
          key,
          "disconnect",
          "Disconnect",
          `<input type="hidden" name="id" value="${escapeHtml(c.id)}">`,
          "link",
        )}</td></tr>`,
    )
    .join("");
  return `<section class="step" aria-labelledby="h-apps"><h2 id="h-apps">Connected apps</h2>
${
  connections.length
    ? `<table class="keys"><thead><tr><th>App</th><th>Connected</th><th>Last used</th><th></th></tr></thead><tbody>${rows}</tbody></table>
<p class="small">Apps that signed in with this subscription. They keep working when you replace a key; disconnecting ends an app's access at once (allow a minute everywhere).</p>`
    : `<p>None yet.</p>`
}
<p class="small">Claude (Desktop, web and mobile) and ChatGPT cannot send a key header: add the custom connector <code>${escapeHtml(api)}/mcp/signin</code> and sign in with your key. Its plan applies.</p></section>`;
}

/** The account page for a known key; `newKey` is shown once after a rotation or a new key. */
export function accountPage(
  s: AccountSummary,
  key: string,
  opts: AccountPageOptions = {},
): Response {
  const active = s.status === "active";
  const api = trim(opts.api ?? DEFAULT_API);
  const rows = s.keys.items
    .map(
      (k) =>
        `<tr><td><code>${escapeHtml(k.id)}</code>${k.current ? " (this key)" : ""}</td><td data-label="Created">${escapeHtml(k.created.slice(0, 10))}</td><td data-label="Last used">${k.last_used_at ? escapeHtml(utc(k.last_used_at)) : "Not yet"}</td><td>${
          active && s.keys.count > 1
            ? actionForm(
                key,
                "revoke",
                "Revoke",
                `<input type="hidden" name="id" value="${escapeHtml(k.id)}">`,
                "link",
              )
            : ""
        }</td></tr>`,
    )
    .join("");
  const newKey = opts.newKey
    ? `<section class="step" aria-labelledby="h-new"><h2 id="h-new">Your new key</h2><div class="block key"><pre class="key" id="new-key">${escapeHtml(opts.newKey)}</pre><button type="button" class="copy" data-copy="new-key">Copy</button></div><p>Shown <strong>once</strong>: copy it now. It can take up to a minute to activate everywhere.</p></section>`
    : "";
  const u = opts.usage;
  const usage = u
    ? `<section class="step" aria-labelledby="h-usage"><h2 id="h-usage">Last 30 days</h2>
${sparkline(u)}
<p class="small">${u.total.toLocaleString("en-US")} charged lookups from ${escapeHtml(u.from)} to ${escapeHtml(u.to)} (UTC days). The same data: <code>GET ${escapeHtml(api)}/v1/account/usage</code> or the <code>account_usage</code> MCP tool.</p>
<details class="client"><summary>By tool and region</summary><p>By tool</p><ul class="plain">${tally(u.by_tool)}</ul><p>By region (state FIPS prefix; searches are <code>search</code>)</p><ul class="plain">${tally(u.by_region)}</ul></details>
</section>`
    : "";
  const regions = opts.regions?.length
    ? `<section class="step" aria-labelledby="h-regions"><h2 id="h-regions">Hosted regions</h2>
<ul class="plain">${opts.regions
        .map(
          (r) =>
            `<li><strong>${escapeHtml(r.state)}</strong>: ${r.counties} ${r.counties === 1 ? "county" : "counties"}, ${r.parcels.toLocaleString("en-US")} parcels${r.as_of ? `, as of ${escapeHtml(r.as_of)}` : ""}</li>`,
        )
        .join("")}</ul>
<p class="small">${escapeHtml(HOSTING_NOTE)} From <code>registry_coverage</code>, which is free.</p></section>`
    : "";
  return page(
    "Your FactLot account",
    `<h1>${escapeHtml(s.plan_name)}</h1>
${opts.notice ? notice(opts.notice, (opts.status ?? 200) >= 400) : ""}
${newKey}
${accountFacts(s, opts.receipts)}
${usage}
<section class="step" aria-labelledby="h-billing"><h2 id="h-billing">Billing</h2>
<p>Change your card, see invoices, switch plans or cancel in Stripe's billing portal.</p>
<div class="buttons">${actionForm(key, "portal", "Manage billing / cancel", "", "primary")}</div></section>
<section class="step" aria-labelledby="h-keys"><h2 id="h-keys">Keys</h2>
<table class="keys"><thead><tr><th>Key id</th><th>Created</th><th>Last used</th><th></th></tr></thead><tbody>${rows}</tbody></table>
${
  active
    ? `<div class="buttons">${actionForm(key, "rotate", "Replace this key")}${
        s.keys.count < s.keys.limit ? actionForm(key, "mint", "Add a key") : ""
      }</div>
<p class="small">Replacing a key stops the old one at once (allow a minute everywhere). ${s.keys.limit > 1 ? `Your plan includes up to ${s.keys.limit} keys; they share the monthly registry lookups.` : `Team includes up to ${PLANS.team.maxKeys} keys.`}</p>`
    : ""
}</section>
${opts.connections ? connectionsSection(key, api, opts.connections) : ""}
${regions}
${opts.lifecycle ? stopSection() : ""}
<section class="step" aria-labelledby="h-new-things"><h2 id="h-new-things">What's new</h2>
<ul class="plain">${WHATS_NEW.map((w) => `<li>${escapeHtml(w.text)}</li>`).join("")}</ul>
<p class="small"><a href="${escapeHtml(s.changelog)}">Full changelog</a></p></section>
<section class="step" aria-labelledby="h-help"><h2 id="h-help">Get help</h2>
<p>Email <a href="mailto:${CONTACT}">${CONTACT}</a>${s.plan === "team" ? " (priority support)" : ""}, ask in <a href="${REPO}/discussions">GitHub Discussions</a>, or give your agent the setup guide: <code>${escapeHtml(api)}/v1/onboarding?plan=${escapeHtml(s.plan)}</code>.</p></section>`,
    { status: opts.status, formAction: ACCOUNT_FORM_ACTION, copy: true },
  );
}

/** After POST /account/recover: the same answer whether or not the address has a subscription. */
export const RECOVERY_SENT =
  "If that email has a FactLot subscription, a link is on its way. It works once and expires in 15 minutes.";

export function recoverySentPage(status = 200): Response {
  return messagePage(status, "Check your email", RECOVERY_SENT);
}

/**
 * The page a recovery link opens: the account, and one button that issues a new key (consuming
 * the link). `replaces` names the key a new one would replace when the plan is at its key limit.
 */
export function recoveryPage(
  s: AccountSummary,
  token: string,
  o: { replaces?: string; notice?: string; status?: number } = {},
): Response {
  const action = `/account/recover/${token}`;
  const active = s.status === "active";
  const rows = s.keys.items
    .map(
      (k) =>
        `<tr><td><code>${escapeHtml(k.id)}</code></td><td data-label="Created">${escapeHtml(k.created.slice(0, 10))}</td></tr>`,
    )
    .join("");
  const effect = o.replaces
    ? `Your plan holds ${s.keys.limit} key${s.keys.limit === 1 ? "" : "s"}, so the new key replaces key <code>${escapeHtml(o.replaces)}</code>, which stops working.`
    : "Your other keys keep working.";
  return page(
    "Recover your account",
    `<h1>Recover your account</h1>
${o.notice ? notice(o.notice, (o.status ?? 200) >= 400) : ""}
<p class="lead">Plan: ${escapeHtml(s.plan_name)}.</p>
${accountFacts(s)}
<table class="keys"><thead><tr><th>Key id</th><th>Created</th></tr></thead><tbody>${rows}</tbody></table>
<section class="step" aria-labelledby="h-issue"><h2 id="h-issue">Issue a new key</h2>
${
  active
    ? `<p>${effect} The new key is shown once, on the next page. This link then stops working.</p>
<div class="buttons">${actionForm("", "issue", "Issue a new key", "", "primary", action)}</div>`
    : `<p class="warn">Keys can be issued only while the subscription is active. Fix billing first, then open this page again.</p>`
}
</section>
<section class="step" aria-labelledby="h-billing"><h2 id="h-billing">Billing</h2>
<div class="buttons">${actionForm("", "portal", "Manage billing / cancel", "", "plain", action)}</div></section>`,
    { status: o.status, formAction: ACCOUNT_FORM_ACTION },
  );
}
