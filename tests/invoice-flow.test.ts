import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvoiceFlow, type PaypalRun } from "../lib/invoice-flow";
import { invoiceNumberFor, signScope, verifyScope } from "../lib/scope-token";
import { reconcile } from "../lib/scope";

const reconciliation = reconcile({ currency: "USD", items: [
  { id: "one", description: "Confirmed work", amountCents: 124000, status: "confirmed", evidence: "approved" },
  { id: "two", description: "Unconfirmed banner", amountCents: 15000, status: "unconfirmed", evidence: "maybe" },
] });

function provider(token: string) {
  const number = invoiceNumberFor(verifyScope(token).id);
  let exists = false;
  let status = "DRAFT";
  let total = "1240.00";
  let owner = number;
  let url = "https://www.sandbox.paypal.com/invoice/p/#TEST";
  let failAfterCreate = false;
  let failAfterSend = false;
  const requests: { name: string; input: unknown; requestId?: string }[] = [];
  const run: PaypalRun = async (name, input, requestId) => {
    requests.push({ name, input, requestId });
    if (name === "search_invoicing") return { items: exists ? [{ id: "INV2-TEST-TEST-TEST-TEST", detail: { invoice_number: owner } }] : [] };
    if (name === "create_invoice") {
      exists = true;
      if (failAfterCreate) { failAfterCreate = false; throw new Error("Connection lost after PayPal accepted creation"); }
      return { href: "https://api.sandbox.paypal.com/v2/invoicing/invoices/INV2-TEST-TEST-TEST-TEST" };
    }
    if (name === "get_invoice") return {
      id: "INV2-TEST-TEST-TEST-TEST", status, detail: { invoice_number: owner, metadata: { recipient_view_url: url } },
      amount: { currency_code: "USD", value: total },
      due_amount: { currency_code: "USD", value: status === "PAID" ? "0.00" : total },
      payments: { paid_amount: { currency_code: "USD", value: status === "PAID" ? total : "0.00" } },
    };
    if (name === "send_invoice") {
      status = "SENT";
      if (failAfterSend) { failAfterSend = false; throw new Error("Connection lost after PayPal accepted sending"); }
      return {};
    }
    throw new Error(`Unexpected tool ${name}`);
  };
  return { run, requests, setStatus: (s: string) => { status = s; }, setTotal: (s: string) => { total = s; }, setOwner: (s: string) => { owner = s; }, setUrl: (s: string) => { url = s; },
    loseCreateResponse: () => { failAfterCreate = true; }, loseSendResponse: () => { failAfterSend = true; } };
}

beforeEach(() => {
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "unit-test-signing-key-only");
  vi.stubEnv("SANDBOX_BUYER_EMAIL", "buyer@example.test");
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("signed scope receipt", () => {
  it("rejects changed amounts even if the receipt structure remains valid", () => {
    const token = signScope(reconciliation);
    const [payload, signature] = token.split(".");
    const changed = JSON.parse(Buffer.from(payload, "base64url").toString());
    changed.reconciliation.confirmed[0].amountCents = 1;
    const forged = `${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${signature}`;
    expect(() => verifyScope(forged)).toThrow(/changed/);
  });
  it("rejects expired receipts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T00:00:00Z"));
    const token = signScope(reconciliation);
    vi.setSystemTime(new Date("2026-10-09T00:00:01Z"));
    expect(() => verifyScope(token)).toThrow(/expired/);
  });
  it("checks a signed total against its actual billable lines", () => {
    expect(() => verifyScope(signScope({ ...reconciliation, billableTotalCents: 139000 }))).toThrow(/total/);
  });
});

describe("invoice lifecycle and recovery", () => {
  it("accepts the real sandbox's empty-object no-match response", async () => {
    const token = signScope(reconciliation); const api = provider(token);
    const flow = new InvoiceFlow((name, input, requestId) => name === "search_invoicing" ? Promise.resolve({}) : api.run(name, input, requestId));
    expect((await flow.act("create", token)).status).toBe("DRAFT");
  });
  it("preserves toolkit error envelopes instead of treating them as success", async () => {
    const token = signScope(reconciliation);
    const flow = new InvoiceFlow(async () => ({ ok: false, code: "INVALID_REQUEST", message: "invoice_number exceeds the limit", status: 400 }));
    await expect(flow.act("create", token)).rejects.toThrow(/INVALID_REQUEST: invoice_number exceeds the limit/);
  });
  it("coalesces concurrent creation and recovers the same invoice after process restart", async () => {
    const token = signScope(reconciliation); const api = provider(token); const flow = new InvoiceFlow(api.run);
    const views = await Promise.all([flow.act("create", token), flow.act("create", token)]);
    expect(views[0].invoiceId).toBe(views[1].invoiceId);
    const restarted = new InvoiceFlow(api.run);
    expect((await restarted.act("create", token)).replayed).toBe(true);
    expect(api.requests.filter((r) => r.name === "create_invoice")).toHaveLength(1);
    expect(api.requests.find((r) => r.name === "create_invoice")?.requestId).toMatch(/^[a-f0-9]{32}$/);
  });
  it("keeps the failure visible and finds a created invoice after a lost response", async () => {
    const token = signScope(reconciliation); const api = provider(token); api.loseCreateResponse();
    await expect(new InvoiceFlow(api.run).act("create", token)).rejects.toThrow(/Connection lost/);
    expect((await new InvoiceFlow(api.run).act("create", token)).replayed).toBe(true);
    expect(api.requests.filter((r) => r.name === "create_invoice")).toHaveLength(1);
  });
  it("does not send a second time after the send response was lost or the process restarted", async () => {
    const token = signScope(reconciliation); const api = provider(token); const flow = new InvoiceFlow(api.run);
    const created = await flow.act("create", token); api.loseSendResponse();
    await expect(flow.act("send", token, created.invoiceId)).rejects.toThrow(/Connection lost/);
    const recovered = await new InvoiceFlow(api.run).act("send", token, created.invoiceId);
    expect(recovered.status).toBe("SENT"); expect(recovered.replayed).toBe(true);
    expect(api.requests.filter((r) => r.name === "send_invoice")).toHaveLength(1);
  });
  it("reads actual paid and due amounts and never resends a paid invoice", async () => {
    const token = signScope(reconciliation); const api = provider(token); const flow = new InvoiceFlow(api.run);
    const created = await flow.act("create", token); api.setStatus("PAID");
    const paid = await flow.act("status", token, created.invoiceId);
    expect(paid).toMatchObject({ status: "PAID", paidCents: 124000, dueCents: 0 });
    expect((await flow.act("send", token, created.invoiceId)).replayed).toBe(true);
    expect(api.requests.filter((r) => r.name === "send_invoice")).toHaveLength(0);
  });
  it("refuses to send an invoice from another scope", async () => {
    const token = signScope(reconciliation); const api = provider(token); api.setOwner("SL-OTHER");
    await expect(new InvoiceFlow(api.run).act("send", token, "INV2-TEST-TEST-TEST-TEST")).rejects.toThrow(/does not belong/);
    expect(api.requests.filter((r) => r.name === "send_invoice")).toHaveLength(0);
  });
  it("refuses a provider total mismatch before sending", async () => {
    const token = signScope(reconciliation); const api = provider(token); api.setTotal("9999.00");
    await expect(new InvoiceFlow(api.run).act("send", token, "INV2-TEST-TEST-TEST-TEST")).rejects.toThrow(/total does not match/);
    expect(api.requests.filter((r) => r.name === "send_invoice")).toHaveLength(0);
  });
  it("rejects a payment link outside the sandbox", async () => {
    const token = signScope(reconciliation); const api = provider(token); api.setUrl("https://example.test/invoice/");
    await expect(new InvoiceFlow(api.run).act("status", token, "INV2-TEST-TEST-TEST-TEST")).rejects.toThrow(/unexpected payment link/);
  });
});
