/**
 * T02/T03 probe: prove the PayPal toolkit works through the AI SDK v7 adapter, end to end.
 *
 *   pnpm probe
 *
 * Reads PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET from .env.local, wraps the toolkit's tools with
 * the v4->v7 adapter, and makes one reversible sandbox call (create a catalog product).
 */
import { paypalTools, assertRequiredTools } from "../lib/paypal";

async function main() {
  const names = assertRequiredTools();
  console.log(`[probe] toolkit ready, ${names.length} tools; required present`);

  const create = paypalTools().create_product as unknown as {
    execute: (input: unknown, opts: { toolCallId: string; messages: never[] }) => Promise<unknown>;
  };
  const result = await create.execute(
    { name: "ScopeLedger probe", type: "SERVICE", category: "SOFTWARE" },
    { toolCallId: "probe", messages: [] },
  );
  const text = typeof result === "string" ? result : JSON.stringify(result);
  console.log("[probe] create_product ->", text.slice(0, 200));
  console.log("[probe] SANDBOX OK");
}

main().catch((err) => {
  console.error("[probe] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
