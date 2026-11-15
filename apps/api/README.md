# api

Hono app served alongside the web app in one Vercel project using services.
Local Node development and the AWS Lambda adapter remain supported.

## Local dev
```bash
pnpm dev     # http://localhost:3001/api/health — no .env needed
pnpm test    # end-to-end API tests against in-memory Postgres
```
With no `DATABASE_URL` the API uses PGlite (embedded Postgres) stored in
`.data/`, applies the migrations in `drizzle/` on boot, and returns login
links to the login screen instead of emailing them. Delete `.data/` to start
clean. To develop against Supabase instead, copy `.env.example` to `.env`, set
`DATABASE_URL`, and run `pnpm db:migrate`.

## Schema changes
Edit `src/db/schema.ts`, then:
```bash
pnpm db:generate   # writes a new SQL migration into drizzle/ — commit it
pnpm db:migrate    # applies to DATABASE_URL (local PGlite migrates itself)
```

## Deploy to Vercel with Supabase

The root `vercel.json` defines the `api` (Hono) and `web` (Vite) services.
Vercel discovers the default export in `src/app.ts`. `/api/*` routes to the
API; other paths route to the web service, with an `index.html` fallback for
SPA routes such as `/login`. Deploy the repository root as one Vercel project.

Set these server-side variables for each Vercel environment:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Supabase **transaction pooler** Postgres URL, port **6543**; keep the password secret |
| `JWT_SECRET` | A securely generated secret of at least 32 characters |
| `APP_URL` | Public HTTPS address of the Vercel project, no trailing slash |
| `CORS_ORIGIN` | Same public origin as `APP_URL` |
| `RESEND_API_KEY` | Resend API key for login emails |
| `EMAIL_FROM` | Sender on a verified Resend domain |

Leave **`VITE_API_URL` unset**: the web and API share an origin. Never put a
database URL, JWT secret, or provider key in a `VITE_` variable.
Vercel sets `VERCEL`, which disables local login links, local JWT defaults,
and the PGlite fallback even if `NODE_ENV` is not `production`.

The production driver is postgres-js with `prepare: false` (required by the
transaction pooler) and a pool of at most two connections per serverless
instance. PGlite is still used locally and in tests. Booking creation,
confirmation, completion, cancellation, and expense/receipt deletion use
transactions; booking status transitions lock the booking row. External
side effects and emitted events run only after commit. This replaces the old
section-8 no-transactions caveat for these multi-write operations; it does
not make event delivery durable or retry failed external calls.

Before the first deployment, the human must supply a new, empty Supabase
database and run `pnpm --filter api db:migrate` from the repository root.
Apply new migrations before deployments that need them. Do not run the
initial migration against an existing, unmanaged schema without deciding
how to baseline it first.

## Optional AWS Lambda deployment
```bash
pnpm build         # → dist/lambda/index.mjs (single bundled ESM file)
```
Create a Lambda (nodejs20.x, arm64, 512MB, 15s timeout), upload dist/lambda/,
handler `index.handler`, enable a Function URL (auth NONE — the app does its
own auth), and set the server-side env vars above: `DATABASE_URL`,
`JWT_SECRET`, `APP_URL` and `CORS_ORIGIN` at minimum. Run `pnpm db:migrate`
against the production database before the first deploy and after each schema
change. Build the web app with `VITE_API_URL=<function url>` if it is not
served from the same origin.

Each integration switches on when its env vars are present, and
`GET /api/health` reports which are live so the web app only offers what works:

| Env | Turns on |
|-----|----------|
| `RESEND_API_KEY` | Emailed login links (otherwise logged) |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | Card payment links |
| `N8N_WEBHOOK_URL` + `INTERNAL_SECRET` | WhatsApp + calendar automation |

## Conventions
- Every handler validates with @sorted/core zod schemas, scopes every query
  by userId, and returns plain rows (camelCase). Request bodies are snake_case.
  See handlers/bookings.ts (reference).
- Money is integer cents everywhere. Timestamps are timestamptz.
- Side-effects (WhatsApp/Calendar) never happen here — emit events instead
  (lib/events.ts).
