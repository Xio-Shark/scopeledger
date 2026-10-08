# ScopeLedger

**Reconcile a client chat against a fixed quote, then turn the confirmed changes into a real PayPal invoice.**

Built for the PayPal AI Hackathon. Live demo: https://scopeledger.wangbohan.biz

## The problem

Freelancers taking small jobs get scope changes scattered across chat: "logo approved", "add two more
posters", "maybe the banner too". At billing time they either miss a chargeable change or bill something
the client never agreed to.

## What it does

1. Paste the client chat next to the fixed quote.
2. The model classifies every line into **quoted**, **confirmed** (the client explicitly agreed) or
   **unconfirmed** (mentioned, not agreed), quoting the client's own words as evidence.
3. The server computes the billable total from quoted + confirmed lines only. An unconfirmed change is
   never billed, and a change with no client-stated price is flagged instead of guessed.
4. One click creates a real PayPal invoice draft (sandbox) and another sends it. Sending twice does not
   create a second invoice.

**Division of labour:** the model only interprets language and cites evidence. Amounts, currency, state
transitions and idempotency are enforced by server code (`lib/scope.ts`, `lib/idempotency.ts`).

## PayPal integration

Uses the official [`@paypal/agent-toolkit`](https://github.com/paypal/agent-toolkit) through a small
adapter so its tools work with AI SDK v7 (`lib/paypal.ts`): the toolkit ships AI SDK v4 tool objects
(`parameters`), v7 expects `inputSchema`. Everything runs against the PayPal **sandbox**; the demo
shows real invoice IDs and real state transitions, not mocks.

## Run it

```bash
pnpm install
cp .env.example .env.local   # fill LLM_* (any OpenAI-compatible endpoint) and PAYPAL_* (sandbox)
pnpm probe                   # proves the PayPal adapter with a real sandbox call
pnpm dev
```

Checks: `pnpm typecheck && pnpm lint && pnpm test`

## Deploy

Next.js standalone output; see `Dockerfile` / `compose.yaml`, or ship `.next/standalone` to any Node 22
host and run `node server.js`.

## Stack

Next.js 16 · React 19 · Tailwind 4 · Vercel AI SDK 7 · `@paypal/agent-toolkit` · zod · vitest

## License

MIT
