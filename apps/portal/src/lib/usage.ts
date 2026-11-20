// Usage metadata that clients report per attempt (see the "Usage metadata" convention in README.md).
// Any numeric metadata key is summed per variant by the API; these well-known keys get labels,
// units and a fixed order. Unknown numeric keys are still shown, after these, with their raw name.

const int = (n: number) => Math.round(n).toLocaleString();
const plain = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: Number.isInteger(n) ? 0 : 4 });

/** $0.0012 for small amounts, $1.23 above a cent. */
export function usd(n: number): string {
  if (n === 0) return "$0";
  return Math.abs(n) < 0.01 ? `$${n.toPrecision(2)}` : `$${n.toFixed(2)}`;
}

export const USAGE_KEYS: Record<string, { label: string; short: string; format: (n: number) => string; lowerIsBetter?: boolean }> = {
  costUsd: { label: "Cost", short: "", format: usd, lowerIsBetter: true },
  inputTokens: { label: "Input tokens", short: "in", format: int },
  outputTokens: { label: "Output tokens", short: "out", format: int },
  totalTokens: { label: "Total tokens", short: "tok", format: int },
};

export const metaLabel = (key: string) => USAGE_KEYS[key]?.label ?? key;
export const formatMeta = (key: string, n: number) => (USAGE_KEYS[key]?.format ?? plain)(n);

/** Well-known usage keys first (cost, tokens), then the rest alphabetically. */
export function orderMetaKeys(keys: Iterable<string>): string[] {
  const all = [...new Set(keys)];
  const known = Object.keys(USAGE_KEYS).filter((k) => all.includes(k));
  return [...known, ...all.filter((k) => !(k in USAGE_KEYS)).sort()];
}

/** "412 in · 96 out · $0.0012" for one attempt's metadata, or null if it reported no usage. */
export function usageLine(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const parts = Object.keys(USAGE_KEYS).flatMap((k) => {
    const v = metadata[k];
    if (typeof v !== "number") return [];
    const { short, format } = USAGE_KEYS[k]!;
    return [short ? `${format(v)} ${short}` : format(v)];
  });
  return parts.length ? parts.join(" · ") : null;
}
