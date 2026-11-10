# Architecture

## The one-paragraph version

A mobile-first PWA talks to a small REST API running on AWS Lambda. The API does
boring CRUD against Postgres and, whenever something interesting happens
(booking confirmed, job completed, payment received), it POSTs a domain event to
an n8n webhook. n8n owns every side-effect: WhatsApp messages, Google Calendar
events, review requests, reminder scheduling. Stripe webhooks flow back into the
API to mark payments paid. Year-end is a single SQL aggregation exported to CSV.

```
┌─────────┐     REST      ┌──────────────┐    events     ┌─────────┐
│   PWA    │ ───────────▶ │  API (Lambda) │ ────────────▶ │   n8n    │
│ (React)  │ ◀─────────── │  Hono + Drizzle│              │          │
└─────────┘               └──────┬────────┘               └────┬────┘
                                 │                              │
                          ┌──────▼──────┐          ┌────────────┼────────────┐
                          │  Postgres    │          ▼            ▼            ▼
                          │  (Neon)      │      WhatsApp     Google Cal    (future)
                          └─────────────┘      Cloud API       API
                                 ▲
                     Stripe webhooks (payment.paid)
```

## Key decisions and why

### Postgres over DynamoDB
The stickiest feature in the pitch is the year-end report: income, expenses,
profit, categorised, exportable. That is a relational aggregation problem
(`SUM(payments) GROUP BY month`, `SUM(expenses) GROUP BY category`). Doing that
in DynamoDB means either scanning tables or maintaining aggregate items by hand.
Neon's serverless Postgres has a free tier, scales to zero, and works over HTTP
from Lambda (no connection-pool pain via `@neondatabase/serverless`).

### Events out to n8n, not inline side-effects
Sending a WhatsApp message inside the "create booking" request handler couples
your API's latency and error handling to Meta's API. Instead the handler writes
to the DB, then fire-and-forgets a small JSON event to an n8n webhook. Benefits:

- Handlers stay 30 lines of testable CRUD.
- You can rewire messaging logic in the n8n UI without deploying code.
- Retries, delays ("wait until 24h before booking"), and template management
  live where they're easy to see.
- n8n calls **back** into the API (`/internal/*` routes, shared-secret auth) to
  log what it sent — so the message history is still in your DB.

### Hono over raw Lambda handlers / Express
Hono is a few KB, has first-class Lambda + local adapters, and typed routing.
You develop with `pnpm dev` (plain Node server), deploy the identical app as
one Lambda behind a function URL or API Gateway. No SAM local / serverless-offline
emulation needed.

### One Lambda, not one-function-per-route
At this scale a single "fat" Lambda routing internally via Hono is simpler to
deploy, keeps cold starts down (one warm container serves everything), and you
can split later if a route ever needs different memory/timeout.

### Stripe first, Revolut second
Stripe Payment Links are a one-call API (`paymentLinks.create`) with reliable
webhooks. Revolut's merchant API is worth adding once the flow is validated,
because Irish clients often prefer it — but it's an M-later, not an M1.

### Auth: magic link, single-tenant-per-user
Sole traders. No teams, no roles. Email magic link → JWT in an httpOnly-ish
storage (PWA: localStorage is acceptable at MVP, revisit). One `users` row owns
everything via `user_id` FK. Keep it embarrassingly simple.

### Expense OCR
Receipt photo → storage (Postgres today — see DATA_MODEL `receipts`; S3
presigned upload when volume justifies it) → API calls a vision model (Claude via
Anthropic API, or AWS Textract) to extract merchant / amount / date / suggested
category → user confirms with one tap. The confirm step matters: never silently
write OCR guesses into tax records.

## Environments

| Env   | API                  | DB           | n8n              |
|-------|----------------------|--------------|------------------|
| local | `pnpm dev` (:3001)   | Neon branch  | n8n cloud (test webhooks) or local docker |
| prod  | Lambda + func URL    | Neon main    | n8n cloud        |

## Security notes (MVP-appropriate)

- All `/api/*` routes require a valid JWT except auth + Stripe webhook.
- `/internal/*` routes (called by n8n) require `X-Internal-Secret` header.
- Stripe webhook signature verified with `STRIPE_WEBHOOK_SECRET`.
- Phone numbers stored E.164. GDPR: add a "delete client + cascade" endpoint
  before public launch (stubbed in plan, M8).
