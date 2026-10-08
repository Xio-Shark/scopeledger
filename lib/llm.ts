// Model access via any OpenAI-compatible endpoint (currently the OpenCode Go gateway). Server-only.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { randomUUID } from "node:crypto";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

/** The OpenCode Go gateway rejects requests without x-opencode-session (400 MissingSessionID);
 * other OpenAI-compatible gateways do not want it, so send it only when the base URL is OpenCode. */
export function chatModel(session: string = randomUUID()) {
  const baseURL = requireEnv("LLM_BASE_URL");
  const headers = baseURL.includes("opencode")
    ? { "x-opencode-session": `scopeledger-${session}` }
    : undefined;
  const provider = createOpenAICompatible({
    name: "llm",
    baseURL,
    apiKey: requireEnv("LLM_API_KEY"),
    headers,
  });
  return provider(requireEnv("LLM_MODEL"));
}
