import { NextResponse } from "next/server";
import { z } from "zod";
import { InvoiceFlow } from "@/lib/invoice-flow";
import { InvoiceError } from "@/lib/scope-token";
import { paypalTools } from "@/lib/paypal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RequestBody = z.object({
  action: z.enum(["create", "send", "status"]),
  scopeToken: z.string().min(1).max(100_000),
  invoiceId: z.string().optional(),
}).strict();
type Exec = { execute: (input: unknown, opts: { toolCallId: string; messages: never[] }) => Promise<unknown> };
const flow = new InvoiceFlow(async (name, input, requestId) => {
  const tools = paypalTools(requestId) as unknown as Record<string, Exec>;
  if (!tools[name]) throw new Error(`PayPal toolkit is missing ${name}`);
  return tools[name].execute(input, { toolCallId: "scope", messages: [] });
});

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const parsed = RequestBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Expected an action and signed scope receipt" }, { status: 400 });
  try {
    const { action, scopeToken, invoiceId } = parsed.data;
    return NextResponse.json(await flow.act(action, scopeToken, invoiceId), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message.slice(0, 300) }, { status: err instanceof InvoiceError ? err.status : 502 });
  }
}
