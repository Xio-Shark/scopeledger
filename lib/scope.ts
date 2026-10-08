// Server-side reconciliation rules. The model proposes; this module decides.
//
// Every billable amount, the total and the currency are computed here from typed input, never by
// the model. The invariant that matters: an unconfirmed change is never billable, and the total is
// the sum of billable lines only.
import { z } from "zod";

export const CURRENCY = "USD" as const;

export const LineStatus = z.enum([
  "quoted", // part of the original fixed quote
  "confirmed", // a change the client explicitly confirmed
  "unconfirmed", // a change with no confirmation in the chat; never billed
]);
export type LineStatus = z.infer<typeof LineStatus>;

export const LineItem = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  status: LineStatus,
  /** The client's original words this line is traced to; empty for the original quote. */
  evidence: z.string().default(""),
});
export type LineItem = z.infer<typeof LineItem>;

export const Quote = z.object({
  currency: z.literal(CURRENCY),
  items: z.array(LineItem).min(1),
});
export type Quote = z.infer<typeof Quote>;

export const ReconciliationSchema = z.object({
  quoted: z.array(LineItem),
  confirmed: z.array(LineItem),
  unconfirmed: z.array(LineItem),
  billableTotalCents: z.number().int().nonnegative(),
  currency: z.literal(CURRENCY),
});
export type Reconciliation = z.infer<typeof ReconciliationSchema>;

/** Partition the lines and compute the server-side total. Unconfirmed lines are never billable. */
export function reconcile(quote: Quote): Reconciliation {
  const quoted = quote.items.filter((i) => i.status === "quoted");
  const confirmed = quote.items.filter((i) => i.status === "confirmed");
  const unconfirmed = quote.items.filter((i) => i.status === "unconfirmed");
  return {
    quoted,
    confirmed,
    unconfirmed,
    billableTotalCents: sumCents([...quoted, ...confirmed]),
    currency: quote.currency,
  };
}

export function sumCents(items: LineItem[]): number {
  return items.reduce((total, item) => total + item.amountCents, 0);
}

export function formatCents(cents: number, currency: typeof CURRENCY = CURRENCY): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/**
 * A change may only become billable when it carries the client's confirming words. This is the gate
 * the model cannot bypass: no evidence, no billing.
 */
export function confirm(item: LineItem, evidence: string): LineItem {
  if (!evidence.trim()) throw new Error(`cannot confirm ${item.id} without the client's words`);
  return { ...item, status: "confirmed", evidence: evidence.trim() };
}

// ---- Model output contract -------------------------------------------------
// The model only proposes structure; amounts for quoted lines come from the original quote and a
// change without a client-stated price stays at 0 (flagged, never invented).

export const ExtractedItem = z.object({
  description: z.string().min(1),
  /** Only set when the client stated a price; null means "no price in the chat". */
  amountCents: z.number().int().nonnegative().nullable(),
  status: LineStatus,
  evidence: z.string(),
});
export type ExtractedItem = z.infer<typeof ExtractedItem>;

export const Extraction = z.object({
  items: z.array(ExtractedItem),
  questions: z.array(z.string()),
});
export type Extraction = z.infer<typeof Extraction>;

export interface Assembled {
  quote: Quote;
  /** Changes the client never priced; the UI asks for these instead of billing a guess. */
  unpriced: string[];
}

export function assembleQuote(original: LineItem[], extraction: Extraction): Assembled {
  const byDesc = new Map(original.map((i) => [i.description.toLowerCase(), i]));
  const unpriced: string[] = [];
  const lines: LineItem[] = extraction.items.map((item, index) => {
    const base = byDesc.get(item.description.toLowerCase());
    const isQuoted = item.status === "quoted";
    if (!isQuoted && item.amountCents == null) unpriced.push(item.description);
    return {
      id: base?.id ?? `x${index + 1}`,
      description: item.description,
      amountCents: isQuoted && base ? base.amountCents : item.amountCents ?? 0,
      status: item.status,
      evidence: item.evidence,
    };
  });
  return { quote: { currency: CURRENCY, items: lines.length ? lines : original }, unpriced };
}
