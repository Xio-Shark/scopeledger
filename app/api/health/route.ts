import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness probe used by the container healthcheck and the deployment smoke test. */
export async function GET() {
  return NextResponse.json({ ok: true, service: "scopeledger" });
}
