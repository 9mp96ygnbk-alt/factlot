/**
 * Transactional email through Cloudflare Email Service (the `send_email` binding, env.EMAIL):
 * the welcome message after a purchase and account-recovery links. No email carries an API key.
 *
 * Without the binding nothing is sent (the welcome email is skipped; recovery says it is being
 * set up), so the Worker deploys safely before the owner onboards factlot.com for sending. A
 * failed send is logged with the binding's error code only: never the address, link or token.
 */
import { CONTACT } from "./contact.ts";
import { escapeHtml } from "./html.ts";
import { priceText, type Plan } from "./plans.ts";
import type { EmailMessageBuilder, Env } from "./types.ts";

/** Sender on the onboarded factlot.com domain; replies go to the support inbox. */
export const EMAIL_FROM = { email: "accounts@factlot.com", name: "FactLot" };

export function emailConfigured(env: Env): boolean {
  return env.EMAIL !== undefined;
}

/** Send one message; false (and one log line without personal data) when it fails. */
export async function sendEmail(
  env: Env,
  kind:
    | "welcome"
    | "recovery"
    | "signin"
    | "freekey"
    | "freekeydelete"
    | "lifecycle",
  message: Omit<EmailMessageBuilder, "from" | "replyTo">,
): Promise<boolean> {
  if (!env.EMAIL) return false;
  const send = (m: Omit<EmailMessageBuilder, "from" | "replyTo">) =>
    env.EMAIL!.send({ ...m, from: EMAIL_FROM, replyTo: CONTACT });
  try {
    try {
      await send(message);
    } catch (err) {
      // Custom headers (List-Unsubscribe) are on Email Sending's allowlist, but a rejected header
      // (E_HEADER_*) must not lose the message: send it once more without them.
      const code = (err as { code?: unknown } | null)?.code;
      if (
        !message.headers ||
        typeof code !== "string" ||
        !code.startsWith("E_HEADER")
      )
        throw err;
      console.error(
        JSON.stringify({ msg: "email headers rejected", kind, code }),
      );
      const bare: Omit<EmailMessageBuilder, "from" | "replyTo"> = {
        ...message,
      };
      delete bare.headers;
      await send(bare);
    }
    return true;
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    console.error(
      JSON.stringify({
        msg: "email failed",
        kind,
        code: typeof code === "string" ? code.slice(0, 64) : undefined,
        error: err instanceof Error ? err.name : typeof err,
      }),
    );
    return false;
  }
}

/** Plain text and a minimal HTML twin, built from the same paragraphs. */
export function body(paragraphs: string[]): { text: string; html: string } {
  // Links are found in the raw text, then each piece is escaped: a trailing "." or "'" is kept
  // out of the link, and an escaped entity is never cut in half.
  const link = (s: string) => {
    let out = "";
    let last = 0;
    for (const m of s.matchAll(/https:\/\/[^\s<>"]+/g)) {
      const trail = /[.,:;)!?'"]+$/.exec(m[0])?.[0] ?? "";
      const url = m[0].slice(0, m[0].length - trail.length);
      out += `${escapeHtml(s.slice(last, m.index))}<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>${escapeHtml(trail)}`;
      last = m.index + m[0].length;
    }
    return out + escapeHtml(s.slice(last));
  };
  return {
    text: paragraphs.join("\n\n") + "\n",
    html: `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;max-width:560px">${paragraphs
      .map((p) => `<p>${link(p).replaceAll("\n", "<br>")}</p>`)
      .join("")}</body></html>`,
  };
}

export function welcomeMessage(
  plan: Plan,
  site: string,
  api: string,
  back?: { href: string; label: string },
): { subject: string; text: string; html: string } {
  return {
    subject: `Welcome to ${plan.name}`,
    ...body([
      `Thank you for subscribing to ${plan.name} (${priceText(plan)}, renews monthly until cancelled).`,
      "Your API key was shown once on the page after checkout (or collected by your agent). This email does not contain it: FactLot keeps only a hash.",
      `Set up in three steps:\n1. Store the key in a password manager or your agent's secret store.\n2. Connect: MCP server ${api}/mcp with the header "Authorization: Bearer <your key>". Snippets for Claude, ChatGPT, Cursor, VS Code, Python and curl: ${api}/v1/onboarding?plan=${plan.id}\n3. Test: open ${api}/v1/account with the same header; it shows your plan and usage.`,
      `Get back into your account, manage billing or cancel: ${site}/account\nLost the key? On that page, enter this email address and we send a sign-in link.`,
      ...(back ? [`${back.label}: ${back.href}`] : []),
      `Questions: reply to this email or write to ${CONTACT}.`,
    ]),
  };
}

export async function sendWelcomeEmail(
  env: Env,
  to: string,
  plan: Plan,
  back?: { href: string; label: string },
): Promise<boolean> {
  if (!env.EMAIL) return false;
  const site = (env.SITE_URL ?? "https://factlot.com").replace(/\/$/, "");
  const api = (env.API_URL ?? "https://api.factlot.com").replace(/\/$/, "");
  return sendEmail(env, "welcome", {
    to,
    ...welcomeMessage(plan, site, api, back),
  });
}

export function recoveryMessage(
  links: { plan: Plan; url: string }[],
  minutes: number,
): { subject: string; text: string; html: string } {
  return {
    subject: "Your FactLot sign-in link",
    ...body([
      "Someone (we hope you) asked to get back into a FactLot account with this email address.",
      ...links.map(
        (l) =>
          `${l.plan.name}: open this link to see the account and issue a new API key:\n${l.url}`,
      ),
      `The link works once and expires in ${minutes} minutes. If you did not ask for it, ignore this email: nothing changes until the link is used.`,
      `Questions: reply to this email or write to ${CONTACT}.`,
    ]),
  };
}

export function freeKeyMessage(
  url: string,
  minutes: number,
  /**
   * Lifecycle emails (lifecycle.ts) when on: where to connect the key once you have it, and
   * whether the request ticked the box for optional notes.
   */
  extra: { connectUrl?: string; optional?: boolean } = {},
): { subject: string; text: string; html: string } {
  const connectUrl = extra.connectUrl;
  return {
    subject: "Your free FactLot API key",
    ...body([
      extra.optional
        ? "This is a transactional message: someone (we hope you) asked for a free FactLot API key with this email address. The request also ticked the box for optional notes about the key; they start only once you open the link below, and each has a link that stops them."
        : "This is a transactional message: someone (we hope you) asked for a free FactLot API key with this email address. We will not add you to any mailing list.",
      `Open this link and press the button to get the key. It is shown once:\n${url}`,
      `The link works once and expires in ${minutes} minutes. If you did not ask for it, ignore this email: nothing is created until the link is used. A new key replaces any earlier free key for this address.`,
      ...(connectUrl
        ? [
            `Once you have the key, connect it to your assistant (Claude, ChatGPT, Cursor and others): ${connectUrl}`,
          ]
        : []),
      `Questions: reply to this email or write to ${CONTACT}.`,
    ]),
  };
}

export function freeKeyDeleteMessage(
  url: string,
  minutes: number,
): { subject: string; text: string; html: string } {
  return {
    subject: "Delete your free FactLot API key",
    ...body([
      "This is a transactional message: someone (we hope you) asked to delete the free FactLot API key for this email address. We will not add you to any mailing list.",
      `Open this link and press the button to delete the key and the records kept for this address. Nothing is deleted until you press it:\n${url}`,
      `The link works once and expires in ${minutes} minutes. If you did not ask for it, ignore this email: nothing changes. This email does not contain a key.`,
      `Questions: reply to this email or write to ${CONTACT}.`,
    ]),
  };
}
