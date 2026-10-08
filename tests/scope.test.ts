import { describe, expect, it } from "vitest";
import { assembleQuote, confirm, formatCents, Quote, reconcile, sumCents } from "../lib/scope";
import { IdempotencyStore } from "../lib/idempotency";
import { invoiceIdFrom, toPaypalInvoice } from "../lib/invoice";

const quote: Quote = {
  currency: "USD",
  items: [
    { id: "q1", description: "Logo design (fixed quote)", amountCents: 80000, status: "quoted", evidence: "" },
    { id: "c1", description: "Two extra posters", amountCents: 24000, status: "confirmed", evidence: "add two more posters" },
    { id: "u1", description: "Landing page banner", amountCents: 15000, status: "unconfirmed", evidence: "maybe the banner too" },
  ],
};

describe("reconcile", () => {
  it("never bills an unconfirmed change", () => {
    const r = reconcile(quote);
    expect(r.unconfirmed.map((i) => i.id)).toEqual(["u1"]);
    expect(r.billableTotalCents).toBe(80000 + 24000);
    expect(r.billableTotalCents).not.toContain(15000);
  });

  it("splits quoted and confirmed", () => {
    const r = reconcile(quote);
    expect(r.quoted.map((i) => i.id)).toEqual(["q1"]);
    expect(r.confirmed.map((i) => i.id)).toEqual(["c1"]);
  });

  it("formats a server-computed total", () => {
    expect(formatCents(reconcile(quote).billableTotalCents)).toBe("$1,040.00");
    expect(sumCents(quote.items)).toBe(119000);
  });
});

describe("confirm", () => {
  it("refuses to confirm without the client's words", () => {
    expect(() => confirm(quote.items[2], "   ")).toThrow(/without the client's words/);
  });
  it("moves an unconfirmed line to confirmed with evidence", () => {
    const c = confirm(quote.items[2], "yes please add the banner");
    expect(c.status).toBe("confirmed");
    expect(c.evidence).toBe("yes please add the banner");
  });
});

describe("IdempotencyStore", () => {
  it("runs once and replays afterwards", async () => {
    const store = new IdempotencyStore<number>((id) => `k:${id}`);
    let calls = 0;
    const run = async () => ++calls;
    const first = await store.once("s1", run);
    const second = await store.once("s1", run);
    expect(first).toEqual({ value: 1, replayed: false });
    expect(second).toEqual({ value: 1, replayed: true });
    expect(calls).toBe(1);
  });

  it("does not remember a failure", async () => {
    const store = new IdempotencyStore<number>((id) => `k:${id}`);
    await expect(store.once("s2", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    const retry = await store.once("s2", async () => 7);
    expect(retry).toEqual({ value: 7, replayed: false });
  });
});

describe("assembleQuote", () => {
  it("takes quoted amounts from the original quote and flags unpriced changes", () => {
    const original = [{ id: "q1", description: "Logo design", amountCents: 80000, status: "quoted" as const, evidence: "" }];
    const { quote, unpriced } = assembleQuote(original, {
      items: [
        { description: "Logo design", amountCents: null, status: "quoted", evidence: "" },
        { description: "Two extra posters", amountCents: 24000, status: "confirmed", evidence: "add two more posters" },
        { description: "Landing page banner", amountCents: null, status: "unconfirmed", evidence: "maybe the banner too" },
      ],
      questions: ["What is the banner price?"],
    });
    expect(quote.items[0].amountCents).toBe(80000); // from the quote, not the model
    expect(unpriced).toEqual(["Landing page banner"]);
    expect(reconcile(quote).billableTotalCents).toBe(104000); // 80000 + 24000, banner excluded
  });
});

describe("invoice mapping", () => {
  it("reads the invoice id from an object or a JSON string", () => {
    const obj = { rel: "self", href: "https://api.sandbox.paypal.com/v2/invoicing/invoices/INV2-ABCD-EFGH-IJKL-MNOP", method: "GET" };
    expect(invoiceIdFrom(obj)).toBe("INV2-ABCD-EFGH-IJKL-MNOP");
    expect(invoiceIdFrom(JSON.stringify(obj))).toBe("INV2-ABCD-EFGH-IJKL-MNOP");
    expect(() => invoiceIdFrom("nope")).toThrow(/could not read an invoice id/);
  });

  it("bills only quoted+confirmed lines", () => {
    const r = reconcile(quote);
    const draft = toPaypalInvoice(r, { invoiceNumber: "X", buyerEmail: "b@example.com" });
    expect(draft.items.map((i) => i.name)).toEqual(["Logo design (fixed quote)", "Two extra posters"]);
    expect(draft.items.reduce((s, i) => s + Number(i.unit_amount.value), 0)).toBe(1040);
  });
});
