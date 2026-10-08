# ScopeLedger

**Reconcile a client chat against a fixed quote, then turn the confirmed changes into a real PayPal invoice.**

Built for the PayPal AI Hackathon. Live demo: https://scopeledger.wangbohan.biz

[Watch the full PayPal sandbox walkthrough](https://youtu.be/PvSxX8wp_pY)

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
4. Review the total, create a real PayPal invoice draft (sandbox), then send it.
5. Open the PayPal payment page, pay with the sandbox buyer, and refresh the invoice status in ScopeLedger.
6. Refreshing the browser restores the saved scope and reads the invoice back from PayPal. Repeating
   creation or sending reuses the same invoice.

**Division of labour:** the model only interprets language and cites evidence. Original quote prices, the billable total, currency and invoice ownership are enforced by server
code. New change amounts are proposed from the chat and shown for human review before billing.
A server-signed scope receipt binds the invoice to those reviewed lines. PayPal's invoice number,
actual status and stable request IDs allow recovery after a lost response or process restart
(`lib/scope.ts`, `lib/scope-token.ts`, `lib/invoice-flow.ts`).

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

The application requires `PAYPAL_ENVIRONMENT=sandbox` and `SANDBOX_BUYER_EMAIL`. It does not support
live payments. A saved scope expires after 24 hours, and remains on the current browser/device.
Payment status is fetched from PayPal when you refresh status or restore the page. It does not use a
webhook or claim that a browser redirect proves payment. `PAID` and externally recorded payment
statuses remain distinct.

## Deploy

Build with `pnpm build` on a machine with enough memory, then ship the standalone output to a Node
host. `scripts/deploy-racknerd.sh` takes `DEPLOY_HOST` and `DEPLOY_SSH_KEY` from the environment,
excludes env files, retains the previous build, and restores it if the new release fails health checks.
It never builds on the VPS. Deployment secrets must be configured separately on the host.

## Stack

Next.js 16 · React 19 · Tailwind 4 · Vercel AI SDK 7 · `@paypal/agent-toolkit` · zod · vitest

## License

MIT
