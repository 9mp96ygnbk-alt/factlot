/**
 * The small HTML pages billing returns: messages, the key page after checkout, and /account.
 * Every interpolated value is escaped. No scripts: forms post to the Worker.
 */
import type { AccountSummary } from "./billing.ts";
import { priceText, type Plan } from "./plans.ts";

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const CONTACT = "contact@factlot.com";

const STYLE = `
:root{--bg:#fbfaf7;--fg:#1c1b19;--muted:#5d5a54;--card:#fff;--line:#e4e0d8;--accent:#1d4ed8;--on-accent:#fff;--warn:#9a3412}
@media (prefers-color-scheme:dark){:root{--bg:#121211;--fg:#f1efe9;--muted:#a9a59c;--card:#1b1b19;--line:#2e2d2a;--accent:#8ab4ff;--on-accent:#0b1220;--warn:#fdba74}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:720px;margin:0 auto;padding:48px 16px}h1{font-size:1.6rem;margin:0 0 12px}h2{font-size:1.15rem;margin:28px 0 8px}
p{color:var(--muted)}a{color:var(--accent)}
pre,code{font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;color:var(--fg)}
.key{font-size:15px;border-color:var(--accent)}
dl{display:grid;grid-template-columns:minmax(120px,max-content) 1fr;gap:6px 16px;margin:0}dt{color:var(--muted)}dd{margin:0}
form{margin:0}.row{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}
input[type=password]{width:100%;font:15px ui-monospace,Menlo,monospace;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg)}
button{font:inherit;padding:9px 14px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:var(--on-accent);cursor:pointer}
button.plain{background:transparent;color:var(--accent)}
.warn{color:var(--warn)}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-weight:normal}
`;

const BASE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'";

function page(
  status: number,
  title: string,
  body: string,
  formAction = "'none'",
): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} · FactLot</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-security-policy": `${BASE_CSP}; form-action ${formAction}`,
    },
  });
}

export function messagePage(
  status: number,
  title: string,
  message: string,
): Response {
  return page(
    status,
    title,
    `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p>Questions: <a href="mailto:${CONTACT}">${CONTACT}</a> or <a href="https://github.com/9mp96ygnbk-alt/factlot/discussions">GitHub Discussions</a>.</p><p><a href="https://factlot.com/">factlot.com</a></p>`,
  );
}

/** "factlot.com/account" for display, from the site origin. */
const accountText = (site: string) =>
  `${site.replace(/^https?:\/\//, "").replace(/\/$/, "")}/account`;

export function keyPage(
  key: string,
  plan: Plan,
  apiUrl: string,
  siteUrl = "https://factlot.com",
): Response {
  const k = escapeHtml(key);
  const api = escapeHtml(apiUrl.replace(/\/$/, ""));
  const site = escapeHtml(siteUrl.replace(/\/$/, ""));
  const account = escapeHtml(accountText(siteUrl));
  return page(
    200,
    "Your FactLot API key",
    `<h1>Welcome to ${escapeHtml(plan.name)}</h1>
<p>This is your API key. It is shown <strong>once</strong>: copy it into a password manager or your agent's secret store now. FactLot keeps only a hash of it.</p>
<pre class="key">${k}</pre>
<p>Your key can take up to a minute to activate everywhere.</p>
<p>Remote MCP (Claude, ChatGPT, Cursor and other MCP clients): server URL <code>${api}/mcp</code> with the header <code>Authorization: Bearer &lt;key&gt;</code>.</p>
<pre>claude mcp add --transport http factlot ${api}/mcp --header "Authorization: Bearer ${k}"</pre>
<p>REST and OpenAPI: <code>${api}/openapi.json</code>, same header.</p>
<p>Your plan: ${escapeHtml(plan.summary)}</p>
<p>${escapeHtml(priceText(plan))}, renews monthly until cancelled; cancel any time at <a href="${site}/account">${account}</a>.</p>
<p><a href="${site}/account">Manage billing / cancel</a> · Questions: <a href="mailto:${CONTACT}">${CONTACT}</a></p>`,
  );
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
        text: "Cancelled. The key no longer works. A new plan starts at factlot.com/#pricing.",
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

/** The key-entry form of /account. The key travels in a POST body, never in the URL. */
export function accountFormPage(status = 200, notice?: string): Response {
  return page(
    status,
    "Your FactLot account",
    `<h1>Your FactLot account</h1>
${notice ? `<p class="warn">${escapeHtml(notice)}</p>` : ""}
<p>Paste your API key to see your plan and usage, manage billing or cancel, and replace or add keys.</p>
<form method="post" action="/account">
<label for="key">API key</label>
<input id="key" name="key" type="password" autocomplete="off" spellcheck="false" placeholder="fl_live_..." required>
<div class="row"><button type="submit" name="action" value="view">Show my account</button></div>
</form>
<p>Lost your key? Email <a href="mailto:${CONTACT}">${CONTACT}</a> from the address you paid with. No plan yet? See <a href="https://factlot.com/#pricing">pricing</a>.</p>`,
    ACCOUNT_FORM_ACTION,
  );
}

function actionForm(
  key: string,
  action: string,
  label: string,
  extra = "",
  plain = false,
): string {
  return `<form method="post" action="/account"><input type="hidden" name="key" value="${escapeHtml(key)}">${extra}<button type="submit" name="action" value="${action}"${plain ? ' class="plain"' : ""}>${escapeHtml(label)}</button></form>`;
}

/** The account page for a known key; `newKey` is shown once after a rotation or a new key. */
export function accountPage(
  s: AccountSummary,
  key: string,
  opts: { notice?: string; newKey?: string; status?: number } = {},
): Response {
  const st = statusText(s);
  const active = s.status === "active";
  const lookupsLeft = Math.max(
    0,
    s.registry_lookups.limit - s.registry_lookups.used,
  );
  const rows = s.keys.items
    .map(
      (k) =>
        `<tr><td><code>${escapeHtml(k.id)}</code>${k.current ? " (this key)" : ""}</td><td style="white-space:nowrap">${escapeHtml(k.created.slice(0, 10))}</td><td>${
          active && s.keys.count > 1
            ? actionForm(
                key,
                "revoke",
                "Revoke",
                `<input type="hidden" name="id" value="${escapeHtml(k.id)}">`,
                true,
              )
            : ""
        }</td></tr>`,
    )
    .join("");
  const newKey = opts.newKey
    ? `<h2>Your new key</h2><p>Shown <strong>once</strong>: copy it now. It can take up to a minute to activate everywhere.</p><pre class="key">${escapeHtml(opts.newKey)}</pre>`
    : "";
  return page(
    opts.status ?? 200,
    "Your FactLot account",
    `<h1>${escapeHtml(s.plan_name)}</h1>
${opts.notice ? `<p class="warn">${escapeHtml(opts.notice)}</p>` : ""}
${newKey}
<dl>
<dt>Status</dt><dd${st.warn ? ' class="warn"' : ""}>${escapeHtml(st.text)}</dd>
<dt>Price</dt><dd>${escapeHtml(s.price)}, renews monthly until cancelled</dd>
<dt>Rate limit</dt><dd>${s.requests_per_minute.toLocaleString("en-US")} requests a minute per key</dd>
<dt>Registry lookups</dt><dd>${s.registry_lookups.used.toLocaleString("en-US")} of ${s.registry_lookups.limit.toLocaleString("en-US")} used this month (${lookupsLeft.toLocaleString("en-US")} left); resets ${escapeHtml(utc(s.registry_lookups.resets_at))}</dd>
<dt>Keys</dt><dd>${s.keys.count} of ${s.keys.limit}</dd>
${s.payment_failed_at ? `<dt>Last failed payment</dt><dd class="warn">${escapeHtml(utc(s.payment_failed_at))}</dd>` : ""}
${s.deletes_at ? `<dt>Record deleted</dt><dd>${escapeHtml(utc(s.deletes_at))} unless the key is active again</dd>` : ""}
</dl>
<h2>Billing</h2>
<p>Change your card, see invoices, switch plans or cancel in Stripe's billing portal.</p>
<div class="row">${actionForm(key, "portal", "Manage billing / cancel")}</div>
<h2>Keys</h2>
<table><tr><th>Key id</th><th>Created</th><th></th></tr>${rows}</table>
${
  active
    ? `<div class="row">${actionForm(key, "rotate", "Replace this key", "", true)}${
        s.keys.count < s.keys.limit
          ? actionForm(key, "mint", "Add a key", "", true)
          : ""
      }</div>
<p>Replacing a key stops the old one at once (allow a minute everywhere). ${s.keys.limit > 1 ? `Your plan includes up to ${s.keys.limit} keys; they share the monthly registry lookups.` : `Team includes up to 5 keys.`}</p>`
    : ""
}
<p>Questions: <a href="mailto:${CONTACT}">${CONTACT}</a>${s.plan === "team" ? " (priority support)" : ""}.</p>`,
    ACCOUNT_FORM_ACTION,
  );
}
