/**
 * A HyperLogLog sketch (512 registers) for counting distinct callers without keeping any of them.
 * A sketch holds, per register, only the largest "rank" any input produced, so nothing in it can
 * be turned back into a caller. Sketches merge by taking the larger register, which is how the
 * reader combines the isolates of one day and the days of a window. The estimate is exact enough
 * for small counts (linear counting) and about 4.6% off for large ones.
 *
 * Shared by the Worker (usage.ts, adds) and the operator script (scripts/ops, merges and reads).
 */
export const SKETCH_REGISTERS = 512;
const INDEX_BITS = 9;
const RANK_MAX = 32 - INDEX_BITS + 1;

/** Two well-mixed 32-bit halves of a string (cyrb53 style). Not a secret hash: its input is already a salted hash or a key ID. */
function mix(input: string): [number, number] {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return [h1 >>> 0, h2 >>> 0];
}

export function newSketch(): Uint8Array {
  return new Uint8Array(SKETCH_REGISTERS);
}

export function sketchAdd(sketch: Uint8Array, value: string): void {
  const [h1, h2] = mix(value);
  const index = h1 & (SKETCH_REGISTERS - 1);
  // Rank: position of the first set bit of the other half (1 to 32), capped.
  const rank = Math.min(RANK_MAX, h2 === 0 ? RANK_MAX : Math.clz32(h2) + 1);
  if (rank > sketch[index]!) sketch[index] = rank;
}

export function sketchMerge(into: Uint8Array, other: Uint8Array): void {
  for (let i = 0; i < SKETCH_REGISTERS; i++)
    if (other[i]! > into[i]!) into[i] = other[i]!;
}

export function sketchEstimate(sketch: Uint8Array): number {
  const m = SKETCH_REGISTERS;
  let sum = 0;
  let zeros = 0;
  for (let i = 0; i < m; i++) {
    sum += 2 ** -sketch[i]!;
    if (sketch[i] === 0) zeros++;
  }
  const alpha = 0.7213 / (1 + 1.079 / m);
  const raw = (alpha * m * m) / sum;
  if (raw <= 2.5 * m && zeros > 0) return Math.round(m * Math.log(m / zeros));
  return Math.round(raw);
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuv"; // ranks 0 to 31 fit; RANK_MAX is 24

export function sketchToString(sketch: Uint8Array): string {
  let out = "";
  for (let i = 0; i < SKETCH_REGISTERS; i++) out += ALPHABET[sketch[i]!];
  return out;
}

/** Undefined when the text is not a sketch (wrong length or characters). */
export function sketchFromString(text: unknown): Uint8Array | undefined {
  if (typeof text !== "string" || text.length !== SKETCH_REGISTERS)
    return undefined;
  const out = newSketch();
  for (let i = 0; i < SKETCH_REGISTERS; i++) {
    const v = ALPHABET.indexOf(text[i]!);
    if (v < 0) return undefined;
    out[i] = v;
  }
  return out;
}
