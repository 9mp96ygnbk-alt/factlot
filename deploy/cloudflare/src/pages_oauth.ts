/**
 * The OAuth sign-in pages: the consent page an MCP client opens (/authorize), the page an emailed
 * sign-in link opens, and their messages. They use the shared page shell of pages.ts (nonce'd
 * styles, strict CSP, no framing, no scripts). Everything about the client (its name, domain and
 * redirect host) comes from the client itself, so all of it is escaped. The form-action CSP names
 * this origin and the client's redirect origin: the browser follows the answer's redirect to it.
 */
import { CONTACT } from "./contact.ts";
import { escapeHtml } from "./html.ts";
import { messagePage, notice, page } from "./pages.ts";
import {
  ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY,
  ANONYMOUS_REQUESTS_PER_MINUTE,
  PLANS,
  type Plan,
} from "./plans.ts";

/** What the consent page shows about the client, from the library's `describeConsent`. */
export interface ConsentView {
  /** The client's name: self-asserted unless `domain` is set. */
  client: string;
  client_id: string;
  /** For a Client ID Metadata Document client: the domain that publishes it (verified). */
  domain?: string;
  /** Where the authorization goes (MUST be shown). */
  redirect_host: string;
  redirect_origin: string;
  /** The redirect goes to an app on this computer. */
  loopback: boolean;
}

const n = (x: number) => x.toLocaleString("en-US");

/** CSP form-action: this page's origin and where the browser is sent next. */
function formAction(view: ConsentView): string {
  const origin = /^https?:\/\/[A-Za-z0-9.:[\]-]+$/.test(view.redirect_origin)
    ? ` ${view.redirect_origin}`
    : "";
  return `'self'${origin}`;
}

function whoIsAsking(view: ConsentView): string {
  const name = `<strong>${escapeHtml(view.client)}</strong>`;
  const origin = view.domain
    ? `${name}, published by <strong>${escapeHtml(view.domain)}</strong>, wants to use FactLot for you.`
    : `${name} wants to use FactLot for you. This app registered itself, so its name is not verified.`;
  const loopback = view.loopback
    ? `<div class="notice warn" role="note"><p><strong>This sends access to an app on your computer</strong> (${escapeHtml(view.redirect_host)}). Continue only if you just started connecting from it.</p></div>`
    : "";
  return `<p class="lead">${origin}</p>
${loopback}
<dl class="facts"><dt>App</dt><dd>${escapeHtml(view.client)}</dd><dt>Access goes to</dt><dd><code>${escapeHtml(view.redirect_host)}</code></dd><dt>It may</dt><dd>Use FactLot's tools for you (scope <code>mcp</code>): calculators, IDs, documents, rules and registry lookups, at your plan's limits. It cannot change billing or keys.</dd></dl>`;
}

export interface ConsentPageOptions {
  /** Offer "Email me a sign-in link" (the email binding and signing secret are set). */
  email?: boolean;
  status?: number;
  notice?: string;
  /** The library's consent headers (the browser-binding cookie). */
  cookies?: Headers;
}

/**
 * The sign-in and consent page. One form: the key (POSTed, never in a URL) and four buttons. The
 * first, the default on Enter, connects with the key.
 */
export function consentPage(
  view: ConsentView,
  handle: string,
  o: ConsentPageOptions = {},
): Response {
  const pro = PLANS.pro;
  const team = PLANS.team;
  const status = o.status ?? 200;
  const emailBlock = o.email
    ? `<section class="step" aria-labelledby="h-email"><h2 id="h-email">No key at hand?</h2>
<label for="email">Email you paid with</label><input id="email" name="email" type="email" autocomplete="email" maxlength="254">
<div class="buttons"><button type="submit" class="button" name="decision" value="email" formnovalidate>Email me a sign-in link</button></div>
<p class="small">The link connects this app to your subscription. Open it in this browser within 10 minutes.</p></section>`
    : "";
  const res = page(
    "Connect to FactLot",
    `<h1>Connect ${escapeHtml(view.client)} to FactLot</h1>
${o.notice ? notice(o.notice, status >= 400) : ""}
${whoIsAsking(view)}
<form method="post" action="/authorize" autocomplete="off">
<input type="hidden" name="handle" value="${escapeHtml(handle)}">
<section class="step" aria-labelledby="h-key"><h2 id="h-key">Sign in with your FactLot key</h2>
<label for="key">API key</label><input id="key" name="key" type="password" spellcheck="false" placeholder="fl_live_..." autocomplete="off">
<div class="buttons"><button type="submit" class="button primary" name="decision" value="key">Connect with my key</button></div>
<p class="small">The connection gets your plan: ${escapeHtml(pro.name)} ${n(pro.requestsPerMinute)} requests a minute and ${n(pro.registryLookupsPerMonth)} registry lookups a month; ${escapeHtml(team.name)} ${n(team.requestsPerMinute)} and ${n(team.registryLookupsPerMonth)}, shared with your keys. FactLot checks the key once and ties the connection to your subscription, not to the key: replacing the key keeps it connected; if the subscription ends, so does the connection. See or disconnect apps at factlot.com/account.</p>
</section>
${emailBlock}
<section class="step" aria-labelledby="h-free"><h2 id="h-free">No plan?</h2>
<div class="buttons"><button type="submit" class="button" name="decision" value="free" formnovalidate>Continue on the free tier</button></div>
<p class="small">Every tool except the two model-backed tools and the registry batch lookup, ${n(ANONYMOUS_REQUESTS_PER_MINUTE)} requests a minute and ${n(ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY)} registry lookups a day for this connection, with the current roll year's value history. Paid plans: <a href="https://factlot.com/pricing/">factlot.com/pricing</a>.</p>
</section>
<div class="buttons"><button type="submit" class="link" name="decision" value="deny" formnovalidate>Cancel and go back</button></div>
</form>
<p class="small">Questions: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`,
    { status, formAction: formAction(view) },
  );
  for (const [k, v] of o.cookies ?? [])
    if (k.toLowerCase() === "set-cookie") res.headers.append(k, v);
  return res;
}

/** The page an emailed sign-in link opens: one POST button (mail scanners only GET). */
export function emailLinkPage(
  view: ConsentView,
  plan: Plan,
  action: string,
  active: boolean,
  status = 200,
): Response {
  return page(
    "Connect to FactLot",
    `<h1>Connect ${escapeHtml(view.client)} to ${escapeHtml(plan.name)}</h1>
${whoIsAsking(view)}
${
  active
    ? `<form method="post" action="${escapeHtml(action)}"><div class="buttons"><button type="submit" class="button primary">Connect ${escapeHtml(plan.name)}</button></div></form>
<p class="small">${n(plan.requestsPerMinute)} requests a minute and ${n(plan.registryLookupsPerMonth)} registry lookups a month, shared with your keys. This link works once.</p>`
    : `<p class="warn">This subscription is not active, so it cannot be connected. Fix billing at <a href="https://factlot.com/account">factlot.com/account</a>, then start again from your app.</p>`
}`,
    { status, formAction: formAction(view) },
  );
}

export function oauthMessagePage(
  status: number,
  title: string,
  message: string,
): Response {
  return messagePage(status, title, message);
}
