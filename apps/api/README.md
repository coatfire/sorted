# api

Hono app that runs identically as a local Node server and a single AWS Lambda.

## Local dev
```bash
pnpm dev     # http://localhost:3001/api/health — no .env needed
pnpm test    # end-to-end API tests against in-memory Postgres
```
With no `DATABASE_URL` the API uses PGlite (embedded Postgres) stored in
`.data/`, applies the migrations in `drizzle/` on boot, and returns login
links to the login screen instead of emailing them. Delete `.data/` to start
clean. To develop against Neon instead, copy `.env.example` to `.env`, set
`DATABASE_URL`, and run `pnpm db:migrate`.

## Schema changes
Edit `src/db/schema.ts`, then:
```bash
pnpm db:generate   # writes a new SQL migration into drizzle/ — commit it
pnpm db:migrate    # applies to DATABASE_URL (local PGlite migrates itself)
```

## Deploy
```bash
pnpm build         # → dist/index.mjs (single bundled ESM file)
```
Create a Lambda (nodejs20.x, arm64, 512MB, 15s timeout), upload dist/,
handler `index.handler`, enable a Function URL (auth NONE — the app does its
own auth), and set the env vars from `.env.example`: `DATABASE_URL`,
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
