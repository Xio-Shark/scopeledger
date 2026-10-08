import { createHash } from "node:crypto";
import { z } from "zod";
import { IdempotencyStore } from "./idempotency";
import { invoiceIdFrom, toPaypalInvoice } from "./invoice";
import { InvoiceError, invoiceNumberFor, verifyScope } from "./scope-token";

export type PaypalRun = (name: string, input: unknown, requestId?: string) => Promise<unknown>;
const Money = z.object({ currency_code: z.literal("USD"), value: z.string().regex(/^\d+(\.\d{1,2})?$/) });
const RawInvoice = z.object({
  id: z.string().regex(/^INV2-[A-Z0-9-]+$/),
  status: z.enum(["DRAFT", "SENT", "SCHEDULED", "PAID", "MARKED_AS_PAID", "CANCELLED", "REFUNDED", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "MARKED_AS_REFUNDED", "UNPAID", "PAYMENT_PENDING", "AUTO_CANCELLED", "PAID_EXTERNAL", "REFUNDED_EXTERNAL", "SHARED"]),
  detail: z.object({ invoice_number: z.string(), metadata: z.object({ recipient_view_url: z.string().optional() }).optional() }),
  amount: Money,
  due_amount: Money.optional(),
  payments: z.object({ paid_amount: Money.optional() }).optional(),
});

export interface InvoiceView {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  totalCents: number;
  dueCents: number | null;
  paidCents: number | null;
  paymentUrl: string | null;
  replayed: boolean;
}

function objectFrom(result: unknown): unknown {
  if (typeof result !== "string") return result;
  if (result === "") return null; // PayPal send can have an empty accepted response.
  try { return JSON.parse(result); }
  catch { throw new InvoiceError("PayPal returned invalid JSON", 502); }
}

function cents(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount)) throw new InvoiceError("PayPal returned an invalid amount", 502);
  return amount;
}

export class InvoiceFlow {
  private readonly creates = new IdempotencyStore<{ invoiceId: string; recovered: boolean }>((id) => id);
  private readonly sends = new IdempotencyStore<string>((id) => id);

  constructor(private readonly run: PaypalRun) {}

  private async call(name: string, input: unknown, requestId?: string): Promise<unknown> {
    const value = objectFrom(await this.run(name, input, requestId));
    if (typeof value === "object" && value !== null && "ok" in value && value.ok === false) {
      const failure = value as { code?: unknown; message?: unknown };
      throw new InvoiceError(`PayPal ${String(failure.code)}: ${String(failure.message)}`, 502);
    }
    return value;
  }

  async act(action: "create" | "send" | "status", token: string, invoiceId?: string): Promise<InvoiceView> {
    const claim = verifyScope(token);
    const number = invoiceNumberFor(claim.id);
    const expected = claim.reconciliation.billableTotalCents;
    if (expected <= 0) throw new InvoiceError("Nothing billable to invoice");
    const read = async (id: string, replayed = false): Promise<InvoiceView> => {
      const parsed = RawInvoice.safeParse(await this.call("get_invoice", { invoice_id: id }));
      if (!parsed.success) throw new InvoiceError("PayPal returned an invalid invoice", 502);
      const invoice = parsed.data;
      if (invoice.id !== id || invoice.detail.invoice_number !== number) throw new InvoiceError("Invoice does not belong to this scope", 403);
      if (cents(invoice.amount.value) !== expected) throw new InvoiceError("PayPal invoice total does not match the confirmed scope", 409);
      let paymentUrl: string | null = null;
      const link = invoice.detail.metadata?.recipient_view_url;
      if (link) {
        const url = new URL(link);
        if (url.protocol !== "https:" || url.hostname !== "www.sandbox.paypal.com" || !url.pathname.startsWith("/invoice/")) {
          throw new InvoiceError("PayPal returned an unexpected payment link", 502);
        }
        paymentUrl = url.href;
      }
      return { invoiceId: id, invoiceNumber: number, status: invoice.status, totalCents: expected,
        dueCents: invoice.due_amount ? cents(invoice.due_amount.value) : null,
        paidCents: invoice.payments?.paid_amount ? cents(invoice.payments.paid_amount.value) : null,
        paymentUrl, replayed };
    };
    const requestId = (operation: string) => createHash("sha256").update(`${operation}:${claim.id}`).digest("hex").slice(0, 32);

    if (action === "create") {
      const outcome = await this.creates.once(claim.id, async () => {
        // Real sandbox searches return {} when nothing matches; reject other malformed shapes.
        const search = z.union([
          z.object({ items: z.array(z.object({ id: z.string(), detail: z.object({ invoice_number: z.string() }) })) }),
          z.object({}).strict(),
        ])
          .safeParse(await this.call("search_invoicing", {
            resource_type: "invoice", invoice_filters: { invoice_number: number }, page_size: 100,
          }));
        if (!search.success) throw new InvoiceError("PayPal returned an invalid invoice search", 502);
        const matches = "items" in search.data ? search.data.items.filter((item) => item.detail.invoice_number === number) : [];
        if (matches.length > 1) throw new InvoiceError("Multiple invoices exist for this scope; inspect PayPal before continuing", 409);
        if (matches.length === 1) return { invoiceId: matches[0].id, recovered: true };
        const buyerEmail = process.env.SANDBOX_BUYER_EMAIL;
        if (!buyerEmail) throw new InvoiceError("SANDBOX_BUYER_EMAIL is not configured", 500);
        const draft = toPaypalInvoice(claim.reconciliation, { invoiceNumber: number, buyerEmail });
        const created = await this.call("create_invoice", draft, requestId("create"));
        return { invoiceId: invoiceIdFrom(created), recovered: false };
      });
      return read(outcome.value.invoiceId, outcome.replayed || outcome.value.recovered);
    }

    if (!invoiceId || !/^INV2-[A-Z0-9-]+$/.test(invoiceId)) throw new InvoiceError("A valid invoice ID is required");
    const current = await read(invoiceId);
    if (action === "status") return current;
    if (["CANCELLED", "AUTO_CANCELLED"].includes(current.status)) throw new InvoiceError(`Cannot send a ${current.status.toLowerCase()} invoice`, 409);
    if (current.status !== "DRAFT") return { ...current, replayed: true };
    const outcome = await this.sends.once(claim.id, async () => {
      await this.call("send_invoice", { invoice_id: invoiceId, send_to_recipient: true }, requestId("send"));
      return invoiceId;
    });
    const sent = await read(outcome.value, outcome.replayed);
    if (sent.status === "DRAFT") throw new InvoiceError("PayPal still reports draft; check status before sending again", 502);
    return sent;
  }
}
