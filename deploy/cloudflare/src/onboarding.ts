/**
 * The setup guide after a purchase, as data. One source feeds the HTML onboarding page
 * (pages.ts), `GET /v1/onboarding` (JSON) and its Markdown form, so a person and an agent read
 * the same steps, snippets and limits.
 */
import { CONTACT } from "./contact.ts";
import {
  ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY,
  ANONYMOUS_REQUESTS_PER_MINUTE,
  MODEL_ALLOWANCES,
  PLANS,
  REPORTS_PER_MONTH,
  REPORT_DOWNLOAD_HOURS,
  QUOTA_RULES,
  priceText,
  type Plan,
} from "./plans.ts";

/** What snippets carry where no key is known (the JSON and Markdown guide). */
export const KEY_PLACEHOLDER = "<key>";

export interface Snippet {
  /** Stable id (HTML element ids, copy buttons). */
  id: string;
  label: string;
  lang: "bash" | "json" | "python" | "text";
  code: string;
}

export interface ClientSetup {
  id: string;
  name: string;
  /** Plain sentences, in order. */
  steps: string[];
  snippets: Snippet[];
  docs: string;
}

export interface Guide {
  title: string;
  plan?: {
    id: string;
    name: string;
    price: string;
    requests_per_minute: number;
    registry_lookups_per_month: number;
    keys: number;
  };
  key: {
    placeholder: string;
    env_var: string;
    header: string;
    notes: string[];
  };
  /** Which clients can send the Authorization header, and what to do with those that cannot. */
  header_clients: string;
  /** For buyers who installed the keyless FactLot plugin first. */
  plugin_note: string;
  clients: ClientSetup[];
  /** Prompts to try once connected (one Texas rules answer, one hosted DC registry lookup). */
  try_first: string[];
  test: {
    method: "GET";
    url: string;
    headers: Record<string, string>;
    expect: string;
    curl: string;
  };
  /** The optional step for the model-backed doc_extract_lease (Pro and Team). */
  extract_lease: {
    title: string;
    /** Whether the hosted API has a model now (the tool is listed and answers). */
    available: boolean;
    text: string;
    mcp_tool: "doc_extract_lease";
    rest: string;
    pages_per_month: { pro: number; team: number };
  };
  /** report_create: client-ready XLSX, PDF and ICS documents from a tool result. */
  reports: {
    title: string;
    mcp_tool: "report_create";
    rest: string;
    text: string;
    per_month: { free: number; pro: number; team: number };
  };
  lookups: typeof QUOTA_RULES;
  limits: {
    free: { requests_per_minute: number; registry_lookups_per_day: number };
    pro: { requests_per_minute: number; registry_lookups_per_month: number };
    team: { requests_per_minute: number; registry_lookups_per_month: number };
  };
  pricing: string[];
  links: {
    account: string;
    recover: string;
    pricing: string;
    mcp: string;
    openapi: string;
    onboarding: string;
    docs: string;
    contact: string;
  };
}

const REPO = "https://github.com/9mp96ygnbk-alt/factlot";

export const HEADER_CLIENTS =
  "Clients that send the Authorization header: Claude Code, Cursor, VS Code, Windsurf, agent SDKs and any REST client. Claude Desktop and claude.ai custom connectors and ChatGPT developer-mode apps have no header field: they sign in instead (add the connector URL ending in /mcp/signin, then paste your key once on the sign-in page).";

export const PLUGIN_NOTE =
  "If you installed the FactLot plugin, its server is keyless; after adding your key, disable the plugin's server in /mcp (or remove the plugin) so lookups use your plan.";

export const TRY_FIRST = [
  "When is my 2027 Texas protest deadline if the notice arrived April 28?",
  "What does FactLot know about 1300 Pennsylvania Ave NW in Washington, DC?",
  "Build the critical-dates calendar for this lease as an ICS file.",
];

/** "$0.0098" for 4900 cents over 5000 lookups. */
function perLookup(plan: Plan): string {
  const dollars = plan.monthlyCents / 100 / plan.registryLookupsPerMonth;
  return `$${dollars.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function setupGuide(o: {
  api: string;
  site: string;
  plan?: Plan;
  /** The real key (only on the page that reveals it); otherwise `placeholder` is used. */
  key?: string;
  placeholder?: string;
  /** Whether the hosted API has a model (ANTHROPIC_API_KEY): the model-backed tools answer. */
  model?: boolean;
}): Guide {
  const api = o.api.replace(/\/$/, "");
  const site = o.site.replace(/\/$/, "");
  const K = o.key ?? o.placeholder ?? KEY_PLACEHOLDER;
  const mcp = `${api}/mcp`;
  const header = `Authorization: Bearer ${K}`;
  const json = (v: unknown) => JSON.stringify(v, null, 2);
  const clients: ClientSetup[] = [
    {
      id: "claude-code",
      name: "Claude Code",
      steps: [
        "Run this once in a terminal. `--scope user` makes the server available in every folder, not only the one you ran it in.",
        "Then open Claude Code and type /mcp; factlot should show as connected.",
        "`claude mcp get factlot` prints the key in plain text: never paste its output into email or a chat.",
      ],
      snippets: [
        {
          id: "claude-code-add",
          label: "Terminal",
          lang: "bash",
          code: `claude mcp add --scope user --transport http factlot ${mcp} --header "${header}"`,
        },
      ],
      docs: `${REPO}/blob/main/connectors/claude/README.md`,
    },
    {
      id: "claude",
      name: "Claude Desktop and claude.ai",
      steps: [
        "Settings → Connectors → Add custom connector. Name it FactLot and enter the sign-in URL below; leave the OAuth client id and secret empty.",
        "Click Connect: a FactLot page opens. Paste your key once and choose Connect with my key. The connection is tied to your subscription, not to the key, so replacing the key keeps it working; see or disconnect it at " +
          site +
          "/account.",
        "The plain URL " +
          mcp +
          " also works there, on the free tier without sign-in. Claude Desktop can instead run the mcp-remote bridge (needs Node.js), which sends the key header: Settings → Developer → Edit Config, add the server below to claude_desktop_config.json, then restart Claude.",
      ],
      snippets: [
        {
          id: "claude-signin-url",
          label: "Connector URL (sign in with your key)",
          lang: "text",
          code: `${mcp}/signin`,
        },
        {
          id: "claude-desktop-config",
          label: "claude_desktop_config.json",
          lang: "json",
          code: json({
            mcpServers: {
              factlot: {
                command: "npx",
                args: [
                  "-y",
                  "mcp-remote",
                  mcp,
                  "--header",
                  "Authorization:${AUTH_HEADER}",
                ],
                env: { AUTH_HEADER: `Bearer ${K}` },
              },
            },
          }),
        },
      ],
      docs: `${REPO}/blob/main/connectors/claude/README.md`,
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      steps: [
        "Settings → Apps → Advanced settings → Developer mode on, then Create: name it FactLot, enter the sign-in URL below, and choose OAuth for authentication (no client id or secret: ChatGPT registers itself).",
        "Click Create, then Connect: a FactLot page opens. Paste your key once and choose Connect with my key. The plain URL " +
          mcp +
          " with No authentication works on the free tier.",
        "Custom GPTs (Actions) take the key directly: Configure → Actions → Create new action → Import from URL with the OpenAPI URL below, then Authentication API Key, Auth Type Bearer.",
      ],
      snippets: [
        {
          id: "chatgpt-signin-url",
          label: "Connector URL (sign in with your key)",
          lang: "text",
          code: `${mcp}/signin`,
        },
        {
          id: "chatgpt-openapi",
          label: "OpenAPI URL (GPT Actions subset)",
          lang: "text",
          code: `${api}/openapi-3.0.json`,
        },
        {
          id: "chatgpt-key",
          label: "API key (Bearer)",
          lang: "text",
          code: K,
        },
      ],
      docs: `${REPO}/blob/main/connectors/chatgpt/README.md`,
    },
    {
      id: "cursor-vscode",
      name: "Cursor and VS Code",
      steps: [
        "Cursor: add this to .cursor/mcp.json in your project (or ~/.cursor/mcp.json for every project).",
        "VS Code (agent mode): add this to .vscode/mcp.json.",
        "Keep these files out of version control: they hold your key.",
      ],
      snippets: [
        {
          id: "cursor-mcp",
          label: ".cursor/mcp.json",
          lang: "json",
          code: json({
            mcpServers: {
              factlot: { url: mcp, headers: { Authorization: `Bearer ${K}` } },
            },
          }),
        },
        {
          id: "vscode-mcp",
          label: ".vscode/mcp.json",
          lang: "json",
          code: json({
            servers: {
              factlot: {
                type: "http",
                url: mcp,
                headers: { Authorization: `Bearer ${K}` },
              },
            },
          }),
        },
      ],
      docs: `${REPO}/blob/main/connectors/others/README.md`,
    },
    {
      id: "python",
      name: "Python",
      steps: [
        "Put the key in the environment, not in code.",
        "The factlot package runs the tools locally with no key; for the hosted API (registry lookups, your plan's limits) call REST with the key, as below.",
      ],
      snippets: [
        {
          id: "python-env",
          label: "Terminal",
          lang: "bash",
          code: `export FACTLOT_API_KEY="${K}"`,
        },
        {
          id: "python-call",
          label: "Python",
          lang: "python",
          code: [
            "import json, os, urllib.request",
            `req = urllib.request.Request("${api}/v1/calc/irr",`,
            '    data=json.dumps({"cash_flows": [-100, 10, 10, 110]}).encode(),',
            '    headers={"Authorization": f"Bearer {os.environ[\'FACTLOT_API_KEY\']}",',
            '             "Content-Type": "application/json", "User-Agent": "my-agent/1.0"})',
            "print(json.load(urllib.request.urlopen(req)))",
          ].join("\n"),
        },
      ],
      docs: `${REPO}/blob/main/connectors/frameworks/README.md`,
    },
    {
      id: "curl",
      name: "curl",
      steps: ["Any HTTP client works the same way: send the header."],
      snippets: [
        {
          id: "curl-irr",
          label: "Terminal",
          lang: "bash",
          code: `curl -s ${api}/v1/calc/irr -H "${header}" \\\n  -H 'content-type: application/json' -d '{"cash_flows":[-100,10,10,110]}'`,
        },
      ],
      docs: `${site}/llms.txt`,
    },
  ];
  const p = o.plan;
  return {
    title: p ? `Set up ${p.name}` : "Set up FactLot",
    ...(p
      ? {
          plan: {
            id: p.id,
            name: p.name,
            price: priceText(p),
            requests_per_minute: p.requestsPerMinute,
            registry_lookups_per_month: p.registryLookupsPerMonth,
            keys: p.maxKeys,
          },
        }
      : {}),
    key: {
      placeholder: KEY_PLACEHOLDER,
      env_var: "FACTLOT_API_KEY",
      header: `Authorization: Bearer ${KEY_PLACEHOLDER}`,
      notes: [
        "The key is shown once. FactLot keeps only a hash of it: store it in a password manager or your agent's secret store.",
        "A new key can take up to a minute to activate everywhere.",
        `Lost it? Recover access at ${site}/account with the email you paid with.`,
      ],
    },
    header_clients: HEADER_CLIENTS,
    plugin_note: PLUGIN_NOTE,
    clients,
    try_first: TRY_FIRST,
    test: {
      method: "GET",
      url: `${api}/v1/account`,
      headers: { Authorization: `Bearer ${K}` },
      expect:
        "200 with plan, plan_name, requests_per_minute and registry_lookups {used, limit, resets_at}. 401 means the key is wrong or not active yet (wait a minute).",
      curl: `curl -s ${api}/v1/account -H "${header}"`,
    },
    extract_lease: {
      title: EXTRACT_LEASE_STEP,
      available: o.model === true,
      text: `With a Pro or Team key, ask your agent to extract a lease: doc_extract_lease sends the lease to a model provider, which proposes each value, and FactLot keeps only the values it finds verbatim in the page text, each with its page and quote. ${o.model === true ? "It is on now." : "It is not switched on yet; doc_abstract_lease and doc_verify_facts (free) work meanwhile."} It counts pages, not registry lookups.`,
      mcp_tool: "doc_extract_lease",
      rest: `POST ${api}/v1/doc/extract_lease`,
      pages_per_month: {
        pro: MODEL_ALLOWANCES.pro.ingest_pages_per_month,
        team: MODEL_ALLOWANCES.team.ingest_pages_per_month,
      },
    },
    reports: {
      title: REPORTS_STEP,
      mcp_tool: "report_create",
      rest: `POST ${api}/v1/reports`,
      text: `Ask for a client-ready document from a result: report_create builds an XLSX workbook, PDF or ICS calendar by code (no model) and returns a download link that works ${REPORT_DOWNLOAD_HOURS} hours. One report counts once against reports a month (${REPORTS_PER_MONTH.anonymous} free, ${REPORTS_PER_MONTH.pro.toLocaleString("en-US")} on Pro, ${REPORTS_PER_MONTH.team.toLocaleString("en-US")} on Team); input errors are free and reports never count as registry lookups.`,
      per_month: {
        free: REPORTS_PER_MONTH.anonymous,
        pro: REPORTS_PER_MONTH.pro,
        team: REPORTS_PER_MONTH.team,
      },
    },
    lookups: QUOTA_RULES,
    limits: {
      free: {
        requests_per_minute: ANONYMOUS_REQUESTS_PER_MINUTE,
        registry_lookups_per_day: ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY,
      },
      pro: {
        requests_per_minute: PLANS.pro.requestsPerMinute,
        registry_lookups_per_month: PLANS.pro.registryLookupsPerMonth,
      },
      team: {
        requests_per_minute: PLANS.team.requestsPerMinute,
        registry_lookups_per_month: PLANS.team.registryLookupsPerMonth,
      },
    },
    pricing: [PLANS.pro, PLANS.team].map(
      (plan) =>
        `${plan.name}: ${priceText(plan)} for ${plan.registryLookupsPerMonth.toLocaleString("en-US")} registry lookups (${perLookup(plan)} a lookup at the full allowance); calculators and other tools do not count. ${REPORTS_PER_MONTH[plan.id].toLocaleString("en-US")} reports a month, built by code with no model.`,
    ),
    links: {
      account: `${site}/account`,
      recover: `${site}/account#recover`,
      pricing: `${site}/pricing/`,
      mcp,
      openapi: `${api}/openapi.json`,
      onboarding: `${api}/v1/onboarding${p ? `?plan=${p.id}` : ""}`,
      docs: `${site}/llms.txt`,
      contact: `mailto:${CONTACT}`,
    },
  };
}

export const REPORTS_STEP = "Build a report: XLSX, PDF or ICS";

export const EXTRACT_LEASE_STEP =
  "Extract a lease with a model, verified by FactLot (Pro and Team)";

/** The guide as Markdown (`Accept: text/markdown`). */
export function guideMarkdown(g: Guide): string {
  const out: string[] = [`# ${g.title}`, ""];
  if (g.plan)
    out.push(
      `${g.plan.name}: ${g.plan.price}, ${g.plan.requests_per_minute.toLocaleString("en-US")} requests a minute per key, ${g.plan.registry_lookups_per_month.toLocaleString("en-US")} registry lookups a month, up to ${g.plan.keys} key${g.plan.keys === 1 ? "" : "s"}.`,
      "",
    );
  out.push(
    "## 1. Save your key",
    "",
    ...g.key.notes.map((n) => `- ${n}`),
    `- Send it as \`${g.key.header}\`; scripts read it from \`${g.key.env_var}\`.`,
    "",
    "## 2. Connect your client",
    "",
    g.header_clients,
    "",
    g.plugin_note,
    "",
  );
  for (const c of g.clients) {
    out.push(`### ${c.name}`, "", ...c.steps.map((s) => `- ${s}`), "");
    for (const s of c.snippets)
      out.push(`${s.label}:`, "", "```" + s.lang, s.code, "```", "");
    out.push(`More: ${c.docs}`, "");
  }
  out.push(
    "## 3. Test your key",
    "",
    "Ask your agent:",
    "",
    ...g.try_first.map((t) => `- ${t}`),
    "",
    "Or check the key itself:",
    "",
    "```bash",
    g.test.curl,
    "```",
    "",
    g.test.expect,
    "",
    `## ${g.extract_lease.title}`,
    "",
    g.extract_lease.text,
    `MCP tool \`${g.extract_lease.mcp_tool}\`; REST \`${g.extract_lease.rest}\`; ${g.extract_lease.pages_per_month.pro.toLocaleString("en-US")} pages a month on Pro, ${g.extract_lease.pages_per_month.team.toLocaleString("en-US")} on Team.`,
    "",
    `## 4. ${g.reports.title}`,
    "",
    g.reports.text,
    `MCP tool \`${g.reports.mcp_tool}\`; REST \`${g.reports.rest}\`; ${g.reports.per_month.free} a month free per IP address, ${g.reports.per_month.pro.toLocaleString("en-US")} on Pro, ${g.reports.per_month.team.toLocaleString("en-US")} on Team.`,
    "",
    "## 5. Know your limits",
    "",
    ...Object.values(g.lookups).map((r) => `- ${r}`),
    "- A report is one document report_create builds and stores; input errors are free, and reports never count as lookups.",
    ...g.pricing.map((r) => `- ${r}`),
    "",
    "## Links",
    "",
    ...Object.entries(g.links).map(([k, v]) => `- ${k}: ${v}`),
    "",
  );
  return out.join("\n");
}
