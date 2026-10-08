// POST /api/scope  { quote: Quote, chat: string } -> reconciliation + questions
//
// The model extracts which quote lines the chat confirms and which new changes appear; the server
// then applies the billing rules (lib/scope.ts). The model never sets the total.
import { generateText, Output } from "ai";
import { NextResponse } from "next/server";
import { Extraction, Quote, assembleQuote, reconcile } from "@/lib/scope";
import { chatModel } from "@/lib/llm";
import { signScope } from "@/lib/scope-token";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM = [
  "You reconcile a freelancer's client chat against a fixed quote.",
  "Return every quote line with status 'quoted' (unchanged), 'confirmed' (the client explicitly agreed to this change) or 'unconfirmed' (mentioned but not agreed).",
  "Add one item per new change the client raised. Copy the client's own words into 'evidence'.",
  "Set amountCents only when the client stated a price in the chat; otherwise use null. Never invent or estimate a price.",
  "Put any missing price or ambiguity into 'questions' instead of guessing.",
  "Return JSON only.",
].join(" ");

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = Quote.safeParse((body as { quote?: unknown })?.quote);
  const chat = (body as { chat?: unknown })?.chat;
  if (!parsed.success || parsed.data.items.length > 100 || typeof chat !== "string" || !chat.trim() || chat.length > 20_000) {
    return NextResponse.json({ error: "body must be { quote: Quote, chat: string }" }, { status: 400 });
  }

  const started = Date.now();
  try {
    const result = await generateText({
      model: chatModel(),
      system: SYSTEM,
      prompt: `Quote (JSON):\n${JSON.stringify(parsed.data)}\n\nClient chat:\n${chat}`,
      output: Output.object({ schema: Extraction }),
    });
    const { quote, unpriced } = assembleQuote(parsed.data.items, result.output);
    const reconciliation = reconcile(quote);
    return NextResponse.json({
      reconciliation,
      scopeToken: signScope(reconciliation),
      questions: result.output.questions,
      unpriced,
      ms: Date.now() - started,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `model failed: ${message.slice(0, 300)}` }, { status: 502 });
  }
}
