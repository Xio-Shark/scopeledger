import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ReconciliationSchema, reconcile, type Reconciliation } from "./scope";

export class InvoiceError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

const ScopeClaim = z.object({
  id: z.string().uuid(), expiresAt: z.number().int().positive(), reconciliation: ReconciliationSchema,
});

function signature(payload: string): Buffer {
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!secret) throw new InvoiceError("PAYPAL_CLIENT_SECRET is not configured", 500);
  // Domain separation keeps the receipt distinct from PayPal authentication.
  return createHmac("sha256", secret).update(`scopeledger:scope:v1:${payload}`).digest();
}

export function signScope(reconciliation: Reconciliation): string {
  const payload = Buffer.from(JSON.stringify({
    id: randomUUID(), expiresAt: Date.now() + 24 * 60 * 60 * 1000, reconciliation,
  })).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function verifyScope(token: string) {
  const parts = token.split(".");
  if (parts.length !== 2 || token.length > 100_000) throw new InvoiceError("Invalid scope receipt");
  const [payload, supplied] = parts;
  const expected = signature(payload);
  const actual = Buffer.from(supplied, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new InvoiceError("Scope receipt was changed; reconcile again", 403);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.from(payload, "base64url").toString()); }
  catch { throw new InvoiceError("Invalid scope receipt"); }
  const parsed = ScopeClaim.safeParse(value);
  if (!parsed.success) throw new InvoiceError("Invalid scope receipt");
  if (parsed.data.expiresAt <= Date.now()) throw new InvoiceError("Scope receipt expired; reconcile again", 410);
  const r = parsed.data.reconciliation;
  const recomputed = reconcile({ currency: r.currency, items: [...r.quoted, ...r.confirmed, ...r.unconfirmed] });
  if (recomputed.billableTotalCents !== r.billableTotalCents || !Number.isSafeInteger(r.billableTotalCents)) {
    throw new InvoiceError("Scope total does not match its line items");
  }
  return parsed.data;
}

export function invoiceNumberFor(scopeId: string): string {
  return `SL-${scopeId.replaceAll("-", "").slice(0, 20).toUpperCase()}`;
}
