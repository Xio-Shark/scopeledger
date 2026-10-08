"use client";

// The ScopeLedger page: paste a chat, reconcile it against a fixed quote, then turn the confirmed
// scope into a real PayPal invoice. Every number shown comes back from the server.
import { useEffect, useState } from "react";
import { z } from "zod";
import { ReconciliationSchema } from "@/lib/scope";
import type { InvoiceView } from "@/lib/invoice-flow";

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
  scopeToken: string;
}

const SESSION_KEY = "scopeledger:session:v2";
const SavedSession = z.object({
  chat: z.string(),
  scope: z.object({ reconciliation: ReconciliationSchema, questions: z.array(z.string()), unpriced: z.array(z.string()), scopeToken: z.string() }),
  invoiceId: z.string().regex(/^INV2-[A-Z0-9-]+$/).nullable(),
});

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

function saveSession(chat: string, scope: ScopeResponse, invoiceId: string | null) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ chat, scope, invoiceId }));
}

const money = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

export default function ScopeLedger() {
  const [chat, setChat] = useState(DEMO_CHAT);
  const [scope, setScope] = useState<ScopeResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<InvoiceView | null>(null);
  const [reconciledChat, setReconciledChat] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    const frame = requestAnimationFrame(() => {
      void (async () => {
        try {
          const saved = localStorage.getItem(SESSION_KEY);
          if (saved) {
            const session = SavedSession.parse(JSON.parse(saved));
            if (!active) return;
            setChat(session.chat);
            setReconciledChat(session.chat);
            setScope(session.scope);
            if (session.invoiceId) {
              const current = await post<InvoiceView>("/api/invoice", { action: "status", scopeToken: session.scope.scopeToken, invoiceId: session.invoiceId });
              if (active) setInvoice(current);
            }
          }
        } catch (e) {
          if (active) setError(`Could not restore this session: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          if (active) setReady(true);
        }
      })();
    });
    return () => { active = false; cancelAnimationFrame(frame); };
  }, []);

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
    const result = await post<ScopeResponse>("/api/scope", { quote: { currency: "USD", items: DEMO_QUOTE }, chat });
    setInvoice(null);
    setScope(result);
    setReconciledChat(chat);
    saveSession(chat, result, null);
  });

  const createInvoice = run("create", async () => {
    if (!scope) return;
    const r = await post<InvoiceView>("/api/invoice", {
      action: "create", scopeToken: scope.scopeToken,
    });
    setInvoice(r);
    saveSession(chat, scope, r.invoiceId);
  });

  const sendInvoice = run("send", async () => {
    if (!invoice || !scope) return;
    const r = await post<InvoiceView>("/api/invoice", {
      action: "send", invoiceId: invoice.invoiceId, scopeToken: scope.scopeToken,
    });
    setInvoice(r);
    saveSession(chat, scope, r.invoiceId);
  });

  const refreshInvoice = run("status", async () => {
    if (!invoice || !scope) return;
    setInvoice(await post<InvoiceView>("/api/invoice", { action: "status", invoiceId: invoice.invoiceId, scopeToken: scope.scopeToken }));
  });
  const scopeIsCurrent = scope !== null && chat === reconciledChat;

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
            disabled={!ready || busy !== null}
            aria-label="Client chat"
          />
        </div>
      </section>

      <button
        className="mt-6 rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        onClick={reconcile}
        disabled={!ready || busy !== null || !chat.trim()}
      >
        {busy === "reconcile" ? "Reconciling…" : "Reconcile changes"}
      </button>

      {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {scope && !scopeIsCurrent && <p className="mt-4 text-sm text-amber-700 dark:text-amber-400">The chat has changed. Reconcile it before creating or sending an invoice.</p>}

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
                  onClick={createInvoice} disabled={!ready || busy !== null || !scopeIsCurrent || invoice !== null || scope.reconciliation.billableTotalCents === 0}>
                  {busy === "create" ? "Creating…" : "Create invoice draft"}
                </button>
                <button className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
                  onClick={sendInvoice} disabled={!ready || busy !== null || !scopeIsCurrent || !invoice}>
                  {busy === "send" ? "Sending…" : "Send invoice"}
                </button>
              </div>
            </div>
            {invoice && (
              <div className="mt-4 space-y-3 text-sm" aria-live="polite">
                <p>PayPal invoice <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">{invoice.invoiceId}</code></p>
                <p>Status from PayPal: <strong className={invoice.status === "PAID" ? "text-emerald-700 dark:text-emerald-400" : ""}>{invoice.status}</strong></p>
                <p>Paid: {invoice.paidCents === null ? "not reported" : money(invoice.paidCents)} · Due: {invoice.dueCents === null ? "not reported" : money(invoice.dueCents)}</p>
                {invoice.replayed && <p className="text-neutral-500">Existing invoice reused — no duplicate action.</p>}
                <div className="flex flex-wrap items-center gap-3">
                  {invoice.paymentUrl && invoice.status !== "DRAFT" && <a className="rounded bg-blue-700 px-3 py-2 text-white" href={invoice.paymentUrl} target="_blank" rel="noopener noreferrer">Open PayPal payment page</a>}
                  <button className="rounded border border-neutral-300 px-3 py-2 disabled:opacity-50 dark:border-neutral-700" onClick={refreshInvoice} disabled={!ready || busy !== null}>{busy === "status" ? "Checking PayPal…" : "Refresh payment status"}</button>
                </div>
                <p className="text-xs text-neutral-500">Sandbox demo · USD · payment status is read directly from PayPal. Saved sessions last up to 24 hours on this device.</p>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
