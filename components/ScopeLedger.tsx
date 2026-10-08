"use client";

// The ScopeLedger page: paste a chat, reconcile it against a fixed quote, then turn the confirmed
// scope into a real PayPal invoice. Every number shown comes back from the server.
import { useState } from "react";

const DEMO_QUOTE = [
  { id: "q1", description: "Logo design", amountCents: 80000, status: "quoted" as const, evidence: "" },
  { id: "q2", description: "Brand guidelines one-pager", amountCents: 20000, status: "quoted" as const, evidence: "" },
];
const DEMO_CHAT =
  "Client: the logo draft looks great, approved. Also can you add two more posters? We said $120 each. Oh and maybe the landing page banner too, not sure yet.";

interface Line {
  id: string;
  description: string;
  amountCents: number;
  status: "quoted" | "confirmed" | "unconfirmed";
  evidence: string;
}
interface Reconciliation {
  quoted: Line[];
  confirmed: Line[];
  unconfirmed: Line[];
  billableTotalCents: number;
  currency: string;
}
interface ScopeResponse {
  reconciliation: Reconciliation;
  questions: string[];
  unpriced: string[];
}

const money = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

export default function ScopeLedger() {
  const [chat, setChat] = useState(DEMO_CHAT);
  const [scope, setScope] = useState<ScopeResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<{ invoiceId: string; replayed?: boolean } | null>(null);

  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data as T;
  }

  const run = (label: string, fn: () => Promise<void>) => async () => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const reconcile = run("reconcile", async () => {
    setInvoice(null);
    setScope(await post<ScopeResponse>("/api/scope", { quote: { currency: "USD", items: DEMO_QUOTE }, chat }));
  });

  const createInvoice = run("create", async () => {
    if (!scope) return;
    const r = await post<{ invoiceId: string }>("/api/invoice", {
      reconciliation: scope.reconciliation,
      target: { invoiceNumber: "SL-DEMO-001", buyerEmail: "sb-buyer@business.example.com" },
    });
    setInvoice(r);
  });

  const sendInvoice = run("send", async () => {
    if (!invoice) return;
    const r = await post<{ invoiceId: string; replayed: boolean }>("/api/invoice?send=1", {
      invoiceId: invoice.invoiceId,
      scopeId: "demo-001",
    });
    setInvoice(r);
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">ScopeLedger</h1>
        <p className="mt-2 max-w-2xl text-neutral-600 dark:text-neutral-400">
          Paste the client chat. ScopeLedger separates what was quoted, what the client confirmed, and
          what was never agreed, then turns the confirmed scope into a real PayPal invoice.
        </p>
      </header>

      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Fixed quote</h2>
          <ul className="mt-2 divide-y divide-neutral-200 rounded border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
            {DEMO_QUOTE.map((l) => (
              <li key={l.id} className="flex justify-between px-3 py-2">
                <span>{l.description}</span>
                <span className="tabular-nums text-neutral-500">{money(l.amountCents)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Client chat</h2>
          <textarea
            className="mt-2 h-32 w-full rounded border border-neutral-300 bg-transparent p-3 text-sm dark:border-neutral-700"
            value={chat}
            onChange={(e) => setChat(e.target.value)}
          />
        </div>
      </section>

      <button
        className="mt-6 rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        onClick={reconcile}
        disabled={busy !== null}
      >
        {busy === "reconcile" ? "Reconciling…" : "Reconcile changes"}
      </button>

      {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

      {scope && (
        <>
          <section className="mt-8 grid gap-4 md:grid-cols-3">
            {(["quoted", "confirmed", "unconfirmed"] as const).map((bucket) => (
              <div key={bucket} className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
                <h3 className="text-sm font-medium capitalize">{bucket}</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {scope.reconciliation[bucket].map((l) => (
                    <li key={l.id}>
                      <div className="flex justify-between gap-2">
                        <span>{l.description}</span>
                        <span className="tabular-nums">{bucket === "unconfirmed" ? "not billed" : money(l.amountCents)}</span>
                      </div>
                      {l.evidence && <p className="mt-0.5 text-xs italic text-neutral-500">“{l.evidence}”</p>}
                    </li>
                  ))}
                  {scope.reconciliation[bucket].length === 0 && <li className="text-neutral-500">none</li>}
                </ul>
              </div>
            ))}
          </section>

          {scope.questions.length > 0 && (
            <ul className="mt-4 list-disc pl-5 text-sm text-amber-700 dark:text-amber-400">
              {scope.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          )}

          <section className="mt-8 rounded border border-neutral-200 p-4 dark:border-neutral-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                Billable total (server-computed):{" "}
                <span className="font-semibold tabular-nums">{money(scope.reconciliation.billableTotalCents)}</span>
              </p>
              <div className="flex gap-2">
                <button className="rounded border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-neutral-700"
                  onClick={createInvoice} disabled={busy !== null || scope.reconciliation.billableTotalCents === 0}>
                  {busy === "create" ? "Creating…" : "Create invoice draft"}
                </button>
                <button className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
                  onClick={sendInvoice} disabled={busy !== null || !invoice}>
                  {busy === "send" ? "Sending…" : "Send invoice"}
                </button>
              </div>
            </div>
            {invoice && (
              <p className="mt-3 text-sm">
                PayPal invoice <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">{invoice.invoiceId}</code>
                {invoice.replayed && <span className="ml-2 text-neutral-500">already sent — not sent again</span>}
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
