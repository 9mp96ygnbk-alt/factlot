/**
 * The setup guide after a purchase, as data. One source feeds the HTML onboarding page
 * (pages.ts), `GET /v1/onboarding` (JSON) and its Markdown form, so a person and an agent read
 * the same steps, snippets and limits.
 */
import { CONTACT } from "./contact.ts";
import {
  ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY,
  ANONYMOUS_REQUESTS_PER_MINUTE,
  PLANS,
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
  clients: ClientSetup[];
  test: {
    method: "GET";
    url: string;
    headers: Record<string, string>;
    expect: string;
    curl: string;
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
        "Run this once in a terminal.",
        "Check it with `claude mcp list`: factlot shows as connected.",
      ],
      snippets: [
        {
          id: "claude-code-add",
          label: "Terminal",
          lang: "bash",
          code: `claude mcp add --transport http factlot ${mcp} --header "${header}"`,
        },
      ],
      docs: `${REPO}/blob/main/connectors/claude/README.md`,
    },
    {
      id: "claude",
      name: "Claude Desktop and claude.ai",
      steps: [
        "Claude Desktop: Settings → Developer → Edit Config, add this server to claude_desktop_config.json, then restart Claude. It runs the mcp-remote bridge (needs Node.js), which sends your key as a header.",
        `claude.ai and mobile: Settings → Connectors → Add custom connector, URL ${mcp}. That form has fields for a URL and OAuth only, not a header, so a connector added there runs on the free tier.`,
      ],
      snippets: [
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
        "Custom GPT (uses your key): Configure → Actions → Create new action → Import from URL, enter the OpenAPI URL below, then set Authentication to API Key, Auth Type Bearer, and paste your key.",
        `Developer mode app: Settings → Apps → Advanced settings → Developer mode, create an app with the URL ${mcp}. If the form has no API key or header field, the app runs on the free tier.`,
      ],
      snippets: [
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
    clients,
    test: {
      method: "GET",
      url: `${api}/v1/account`,
      headers: { Authorization: `Bearer ${K}` },
      expect:
        "200 with plan, plan_name, requests_per_minute and registry_lookups {used, limit, resets_at}. 401 means the key is wrong or not active yet (wait a minute).",
      curl: `curl -s ${api}/v1/account -H "${header}"`,
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
        `${plan.name}: ${priceText(plan)} for ${plan.registryLookupsPerMonth.toLocaleString("en-US")} registry lookups (${perLookup(plan)} a lookup at the full allowance); calculators and other tools do not count.`,
    ),
    links: {
      account: `${site}/account`,
      recover: `${site}/account#recover`,
      pricing: `${site}/#pricing`,
      mcp,
      openapi: `${api}/openapi.json`,
      onboarding: `${api}/v1/onboarding${p ? `?plan=${p.id}` : ""}`,
      docs: `${site}/llms.txt`,
      contact: `mailto:${CONTACT}`,
    },
  };
}

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
    "```bash",
    g.test.curl,
    "```",
    "",
    g.test.expect,
    "",
    "## 4. Know your limits",
    "",
    ...Object.values(g.lookups).map((r) => `- ${r}`),
    ...g.pricing.map((r) => `- ${r}`),
    "",
    "## Links",
    "",
    ...Object.entries(g.links).map(([k, v]) => `- ${k}: ${v}`),
    "",
  );
  return out.join("\n");
}
