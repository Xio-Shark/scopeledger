// PayPal sandbox access through the official agent toolkit, adapted to AI SDK v7.
//
// The toolkit (1.11.0) ships AI SDK v4 tool objects shaped { description, parameters, execute };
// AI SDK v7 expects { description, inputSchema, execute }. The adapter below renames the schema
// field and leaves the schema and executor untouched. Verified against real sandbox calls on
// 2026-10-08 (see ../../docs/t02-probe.md). Two config fields are mandatory: `actions` (else the
// constructor throws) and `context.sandbox` (else requests hit live and fail auth).
import { tool, type ToolSet } from "ai";
import { PayPalAgentToolkit, ALL_TOOLS_ENABLED } from "@paypal/agent-toolkit/ai-sdk";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

type LegacyTool = {
  description?: string;
  parameters: unknown;
  execute: (...args: never[]) => unknown;
};

/** Isolate operation IDs and obtain fresh OAuth credentials; the toolkit caches tokens indefinitely. */
export function paypalTools(requestId?: string): ToolSet {
  if (process.env.PAYPAL_ENVIRONMENT !== "sandbox") throw new Error("ScopeLedger requires PAYPAL_ENVIRONMENT=sandbox");
  const toolkit = new PayPalAgentToolkit({
    clientId: requireEnv("PAYPAL_CLIENT_ID"),
    clientSecret: requireEnv("PAYPAL_CLIENT_SECRET"),
    configuration: {
      actions: ALL_TOOLS_ENABLED,
      context: { sandbox: true, ...(requestId ? { request_id: requestId } : {}) },
    },
  });
  const raw = toolkit.getTools() as unknown as Record<string, LegacyTool>;
  const tools = Object.fromEntries(
    Object.entries(raw).map(([name, def]) => [
      name,
      tool({
        description: def.description,
        inputSchema: def.parameters as never,
        execute: def.execute as never,
      }),
    ]),
  );
  return tools;
}

/** Names of the tools ScopeLedger relies on, checked at startup so a toolkit change fails loudly. */
export const REQUIRED_TOOLS = ["create_invoice", "send_invoice", "search_invoicing", "get_invoice"] as const;

export function assertRequiredTools(): string[] {
  const names = Object.keys(paypalTools());
  const missing = REQUIRED_TOOLS.filter((t) => !names.includes(t));
  if (missing.length) throw new Error(`PayPal toolkit is missing required tools: ${missing.join(", ")}`);
  return names;
}
