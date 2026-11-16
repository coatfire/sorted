# Architecture

## The one-paragraph version

A mobile-first PWA talks to a small REST API running in the same Vercel project
using services. The API does
boring CRUD against Postgres and, whenever something interesting happens
(booking confirmed, job completed, payment received), it POSTs a domain event to
an n8n webhook. n8n owns every side-effect: WhatsApp messages, Google Calendar
events, review requests, reminder scheduling. Stripe webhooks flow back into the
API to mark payments paid. Year-end is a single SQL aggregation exported to CSV.

```
┌─────────┐     REST      ┌──────────────┐    events     ┌─────────┐
│   PWA    │ ───────────▶ │  API (Vercel) │ ────────────▶ │   n8n    │
│ (React)  │ ◀─────────── │  Hono + Drizzle│              │          │
└─────────┘               └──────┬────────┘               └────┬────┘
                                 │                              │
                          ┌──────▼──────┐          ┌────────────┼────────────┐
                          │  Postgres    │          ▼            ▼            ▼
                          │ (Supabase)   │      WhatsApp     Google Cal    (future)
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
Supabase hosts Postgres. The API connects through its transaction pooler on
port 6543 using postgres-js (`prepare: false`, `max: 2`, `max_pipeline: 1`,
`query_timeout: 20`; see `apps/api/src/db/pool.ts`) and Drizzle.
Local development and tests use embedded Postgres (PGlite).

### Atomic writes and post-commit side effects
Booking creation (including inline clients), confirm, complete, cancel, and
expense/receipt deletion run inside database transactions on both drivers.
Status transitions lock the booking row before checking its status. Failures
roll back the dependent writes together; the old section-8 no-transactions
caveat no longer applies to these operations. Events and external calls must
remain outside transaction callbacks and run after commit. Event delivery is
still fire-and-forget, not a transactional outbox.

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

### Hono on Vercel, with a Lambda adapter
Hono provides typed routing and local Node/Lambda adapters. Vercel's Hono
preset discovers the default export in `apps/api/src/app.ts`; the root
`vercel.json` serves `/api/*` from the API service and everything else from
the Vite web service, including an SPA fallback. Leave `VITE_API_URL` unset
for same-origin requests. `pnpm dev` still runs plain Node + Vite, and
`lambda.ts` still builds to `dist/lambda/index.mjs` for optional Lambda hosting.
See `apps/api/README.md` for the required Vercel environment variables.

### Stripe first, Revolut second
Stripe Payment Links are a one-call API (`paymentLinks.create`) with reliable
webhooks. Revolut's merchant API is worth adding once the flow is validated,
because Irish clients often prefer it — but it's an M-later, not an M1.

### Auth: passwords, single-tenant-per-user
Sole traders. No teams, no roles. Email verification applies a pending scrypt
password hash; password login issues a JWT stored in localStorage (revisit for
production hardening). Verification and reset links are single-use and expire
after 15 minutes. Signup/forgot requests and failed logins are rate-limited.
One `users` row owns everything via `user_id` FK.

### Expense OCR
Receipt photo → storage (Postgres today — see DATA_MODEL `receipts`; S3
presigned upload when volume justifies it) → API calls a vision model (Claude via
Anthropic API, or AWS Textract) to extract merchant / amount / date / suggested
category → user confirms with one tap. The confirm step matters: never silently
write OCR guesses into tax records.

## Environments

| Env   | API                  | DB           | n8n              |
|-------|----------------------|--------------|------------------|
| local | `pnpm dev` (:3001)   | PGlite       | n8n cloud (test webhooks) or local docker |
| prod  | Vercel API service  | Supabase pooler (:6543) | n8n cloud |

## Security notes (MVP-appropriate)

- All `/api/*` routes require a valid JWT except auth + Stripe webhook.
- `/internal/*` routes (called by n8n) require `X-Internal-Secret` header.
- Stripe webhook signature verified with `STRIPE_WEBHOOK_SECRET`.
- Phone numbers stored E.164. GDPR: add a "delete client + cascade" endpoint
  before public launch (stubbed in plan, M8).
