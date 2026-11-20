// Shared checks for the attestation of a computing tool's result (no tests of its own).
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import {
  attestationEnabled,
  configureAttestation,
  factsInInput,
  publishedAttestationKeys,
  runToolAsync,
  verifyAttestation,
  ATTESTED_TOOLS,
} from "./index.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

/** A throwaway Ed25519 key as a PEM, made for one test and never written anywhere. */
export async function throwawayKey(): Promise<string> {
  const k = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as webcrypto.CryptoKeyPair;
  const der = Buffer.from(
    await webcrypto.subtle.exportKey("pkcs8", k.privateKey),
  );
  return `-----BEGIN PRIVATE KEY-----\n${der.toString("base64")}\n-----END PRIVATE KEY-----\n`;
}

export async function keyMap(): Promise<Map<string, string>> {
  return new Map((await publishedAttestationKeys()).map((k) => [k.kid, k.x]));
}

/**
 * Runs `tool` with a throwaway key and checks: an attestation is returned and verifies against the
 * published key; each tamper (altered figure, altered grade or text, swapped items, dropped item,
 * altered cited fact, wrong key, wrong kind, altered calculation) is refused. Returns the result.
 */
export async function checkAttested(tool: string, input: Json): Promise<Json> {
  const pem = await throwawayKey();
  configureAttestation({
    signingKey: pem,
    now: () => new Date("2026-11-20T10:00:00Z"),
  });
  try {
    assert.ok(attestationEnabled());
    const o = await runToolAsync(tool, input);
    assert.ok(o.ok, JSON.stringify(o));
    const r = o.result as Json;
    const att = r.attestation as Json;
    assert.equal(att.format, "factlot.result_attestation");
    assert.equal(att.tool.name, tool);
    assert.equal(att.issued_at, "2026-11-20T10:00:00Z");
    assert.equal(att.kind, ATTESTED_TOOLS[tool]);
    assert.match(att.signature, /^[A-Za-z0-9_-]{86}$/);
    const keys = await keyMap();
    const facts = [...factsInInput(input).values()].map((l) => l[0]!) as Json[];
    const sent = {
      kind: att.kind as string,
      items: r.package_items as Json[],
      calculation: r.package_calculation as Json | undefined,
      facts,
    };
    const good = await verifyAttestation(att, sent, keys);
    assert.deepEqual(good.problems, []);
    assert.ok(good.ok);
    assert.equal(good.calculation_covered, r.package_calculation !== undefined);

    const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
    const bad = async (
      name: string,
      change: (s: typeof sent) => void,
      pattern: RegExp,
      key = keys,
      a: Json = att,
    ): Promise<void> => {
      const s = clone(sent);
      change(s);
      const v = await verifyAttestation(a, s, key);
      assert.equal(v.ok, false, `${name}: should be refused`);
      assert.match(v.problems.join("; "), pattern, name);
    };
    const first = sent.items[0]!.key as string;
    await bad(
      "altered figure",
      (s) => {
        s.items[0]!.value = 1;
      },
      new RegExp(`item ${first.replace(/\./g, "\\.")} differs`),
    );
    await bad(
      "altered label",
      (s) => {
        s.items[0]!.label = "Something else";
      },
      /differs from what FactLot computed/,
    );
    if (sent.items.length > 1) {
      await bad(
        "swapped items",
        (s) => {
          [s.items[0], s.items[1]] = [s.items[1]!, s.items[0]!];
        },
        /not in the order/,
      );
      await bad(
        "dropped item",
        (s) => {
          s.items.pop();
        },
        /computed but is not in the package/,
      );
    }
    await bad(
      "extra item",
      (s) => {
        s.items.push({ ...s.items[0]!, key: "ZZ.9" });
      },
      /differs from what FactLot computed/,
    );
    await bad(
      "altered cited fact (replay on a package whose facts differ)",
      (s) => {
        const id = (s.items[0]!.fact_ids as string[])[0]!;
        const f = s.facts.find((x) => x.id === id)!;
        f.value = "changed";
      },
      /is not the fact FactLot computed from/,
    );
    await bad(
      "wrong kind",
      (s) => {
        s.kind = s.kind === "rent_roll" ? "estoppel" : "rent_roll";
      },
      /is for kind/,
    );
    if (sent.calculation) {
      await bad(
        "altered calculation figure",
        (s) => {
          (s.calculation as Json).occupancy = 0.99;
        },
        /calculation differs/,
      );
      await bad(
        "calculation missing",
        (s) => {
          s.calculation = undefined;
        },
        /does not carry/,
      );
    }
    // Wrong key: a different throwaway key's id and public key, same attestation.
    configureAttestation({ signingKey: await throwawayKey() });
    const other = await keyMap();
    configureAttestation(undefined);
    await bad("wrong key", () => {}, /not a key FactLot publishes/, other);
    const [oneId] = [...other.keys()];
    await bad("forged key id", () => {}, /signature does not verify/, other, {
      ...att,
      key_id: oneId,
    });
    // Altering the statement itself breaks the signature.
    await bad(
      "edited attestation",
      () => {},
      /signature does not verify/,
      keys,
      { ...att, result_digest: "0".repeat(64) },
    );
    return r;
  } finally {
    configureAttestation(undefined);
  }
}
