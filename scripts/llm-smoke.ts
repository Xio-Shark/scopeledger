/** Confirms the model gateway (OpenCode Go) works from this app. */
import { generateText } from "ai";
import { chatModel } from "../lib/llm";

async function main() {
  const { text, usage } = await generateText({
    model: chatModel(),
    prompt: "Reply with exactly one word: ok",
  });
  console.log("[llm] reply:", JSON.stringify(text.trim().slice(0, 40)), "| totalTokens:", usage.totalTokens);
}

main().catch((err) => {
  console.error("[llm] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
