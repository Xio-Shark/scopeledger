// POST /api/invoice        { reconciliation, target } -> create a sandbox invoice draft
// POST /api/invoice?send=1 { invoiceId, scopeId }     -> send it once (idempotent per scopeId)
//
// Every PayPal call goes through the toolkit; the amounts come from the server-side reconciliation,
// never from the model.
import { NextResponse } from "next/server";
import { ReconciliationSchema } from "@/lib/scope";
import { invoiceIdFrom, toPaypalInvoice } from "@/lib/invoice";
import { invoiceSendStore } from "@/lib/idempotency";
import { paypalTools } from "@/lib/paypal";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Target = z.object({
  invoiceNumber: z.string().min(1).max(40),
  buyerEmail: z.string().email().optional(),
  invoicer: z
    .object({
      businessName: z.string().optional(),
      givenName: z.string().optional(),
      surname: z.string().optional(),
      emailAddress: z.string().email().optional(),
    })
    .optional(),
});

type Exec = { execute: (input: unknown, opts: { toolCallId: string; messages: never[] }) => Promise<unknown> };
const tool = (name: string): Exec => (paypalTools() as unknown as Record<string, Exec>)[name];
const run = (name: string, input: unknown) => tool(name).execute(input, { toolCallId: "scope", messages: [] });

function asError(err: unknown): string {
  const text = err instanceof Error ? err.message : JSON.stringify(err);
  return text.slice(0, 300);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });

  // Send path: idempotent per scopeId, so a retry or double-click never sends twice.
  if (url.searchParams.get("send")) {
    const invoiceId = body.invoiceId;
    const scopeId = body.scopeId;
    if (typeof invoiceId !== "string" || typeof scopeId !== "string") {
      return NextResponse.json({ error: "send needs { invoiceId, scopeId }" }, { status: 400 });
    }
    try {
      const { value, replayed } = await invoiceSendStore.once(scopeId, async () => {
        await run("send_invoice", { invoice_id: invoiceId, send_to_recipient: true });
        return { invoiceId, sent: true as const };
      });
      return NextResponse.json({ ...value, replayed });
    } catch (err) {
      return NextResponse.json({ error: `send failed: ${asError(err)}` }, { status: 502 });
    }
  }

  // Create path.
  const recon = ReconciliationSchema.safeParse(body.reconciliation);
  const target = Target.safeParse(body.target);
  if (!recon.success || !target.success) {
    return NextResponse.json({ error: "body must be { reconciliation, target }" }, { status: 400 });
  }
  const buyerEmail = target.data.buyerEmail ?? process.env.SANDBOX_BUYER_EMAIL;
  if (!buyerEmail) {
    return NextResponse.json({ error: "no buyer email: pass target.buyerEmail or set SANDBOX_BUYER_EMAIL" }, { status: 400 });
  }
  try {
    const draft = toPaypalInvoice(recon.data, { ...target.data, buyerEmail });
    const created = await run("create_invoice", draft);
    return NextResponse.json({ invoiceId: invoiceIdFrom(created), totalCents: recon.data.billableTotalCents });
  } catch (err) {
    return NextResponse.json({ error: `create failed: ${asError(err)}` }, { status: 502 });
  }
}
