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

## Optional Google sign-in

Create a Google OAuth **Web application** client. Set `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` on the API only; both are required to enable sign-in.
Until then `/api/health` reports `features.googleSignIn: false` and the UI hides
the button. Do not use `VITE_` variables for either credential.

Register this exact authorized redirect URI for production:

```text
https://sorted-weld.vercel.app/api/auth/google/callback
```

The callback URL is `${API_URL || APP_URL}/api/auth/google/callback`; set those
values to the intended deployment origins, never a request-supplied host. For
local development set `API_URL=http://localhost:3001`, `APP_URL=http://localhost:5173`
and register `http://localhost:3001/api/auth/google/callback`. The cookie remains
Secure in development; use localhost (modern browsers permit secure localhost
cookies), or HTTPS for non-localhost testing. Add test users to Google's consent
screen while the OAuth application is in testing mode.

Sign-in uses state, nonce and PKCE with a signed ten-minute HttpOnly cookie.
Google ID tokens are checked server-side against Google's JWKS. A verified
Google email links an existing account without changing its password; a new
account is verified and passwordless, then completes normal profile onboarding.
The redirect carries only a single-use two-minute opaque code; exchange returns
the normal session JWT in JSON, not in a URL. Code hashes are stored in
`login_codes`; password resets invalidate outstanding codes via session version.
Start/exchange have per-IP limits using trusted-proxy `X-Forwarded-For`, with a
shared fallback when absent. OAuth routes omit request logging and use no-store.
No access/refresh tokens are retained and only identity scopes are requested.

Apply migration `0012_google_sign_in` after `0011_booking_quotes` before enabling
credentials. Migration 0012 adds the unique nullable `users.google_sub` and the
short-lived code table. No production Google credentials are provisioned by this
feature. Tests generate an RSA key pair and mock Google's token endpoint/JWKS;
they never need real Google credentials.

## Optional address search

The Location field on a booking always suggests places the trader has used before.
Setting `GOOGLE_MAPS_API_KEY` on the API adds address and venue search for Ireland
through Google's Places API (New). Until then `/api/health` reports
`features.addressSearch: false`, the UI doesn't ask, and no request reaches Google.

1. In Google Cloud, create or pick a project and attach a billing account.
2. Enable **Places API (New)**.
3. Create an API key. Under **API restrictions** allow only Places API (New).
   Leave **Application restrictions** at None: the key is used from the server,
   whose address changes, and it never reaches a browser.
4. Under **Places API (New) → Quotas**, lower the daily limit for Autocomplete
   requests to cap what the key can spend.
5. Set `GOOGLE_MAPS_API_KEY` on the API (Vercel: Production) and redeploy.

Each pause in typing is one billed Autocomplete request. Do not use a `VITE_`
variable for the key.

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
The services build and deploy together; this is the production deployment,
not a separately hosted web app calling a Lambda Function URL.

The API build keeps the alternative Lambda bundle at `dist/lambda/index.mjs`.
Do not create or retain `apps/api/dist/index.mjs`: Vercel's Hono preset would
pick that file as the entrypoint instead of `src/app.ts`. The API build clears
`dist/` before bundling so a stale entrypoint cannot override the source app.

Set these server-side variables for each Vercel environment:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Supabase **transaction pooler** Postgres URL, port **6543**; keep the password secret |
| `JWT_SECRET` | A securely generated secret of at least 32 characters |
| `APP_URL` | Public HTTPS address of the Vercel project, no trailing slash |
| `API_URL` | Optional. Public address of the API if it isn't served from `APP_URL`; used for calendar feed links |
| `CORS_ORIGIN` | Same public origin as `APP_URL` |
| `RESEND_API_KEY` | Resend API key for login emails; required for production login |
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
database. From the repository root, apply the committed migrations using
the Supabase transaction-pooler URL (the ellipsis is a placeholder, not a value):

```bash
DATABASE_URL=… pnpm --filter api db:migrate
```

Apply new migrations before deployments that need them. Do not run the
initial migration against an existing, unmanaged schema without deciding
how to baseline it first.

Every table has row level security on with no policies. Supabase serves the
`public` schema through its Data API, and without RLS its public `anon` role
can read a table. The API is unaffected because `DATABASE_URL` connects as the
tables' owner. A migration that creates a table must also run
`ALTER TABLE … ENABLE ROW LEVEL SECURITY`; `test/row-level-security.test.ts`
fails if one doesn't.

Verify `/api/health` on the deployed origin, then sign up with an email and
password and follow the verification email to `/verify` and `/welcome`.
Existing passwordless users can set their password through `/forgot`.
Production must never show an **Open link**
button or log a login token. If email delivery fails, the API deletes the
undelivered token and returns 502; the login page shows the failure instead
of claiming an email was sent. Only local mode logs/returns a development link.

Optional server-side integrations (no secrets belong in the web service's
`VITE_` variables):

| Variables | Purpose |
|-----------|---------|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Card payment links and signature-verified Stripe webhooks |
| `N8N_WEBHOOK_URL`, `INTERNAL_SECRET` | Emit automation events to n8n and authenticate n8n callbacks; provider credentials stay in n8n |
| `ANTHROPIC_API_KEY` | Reserved for receipt OCR; not currently wired into the API |
| `SENTRY_DSN` | Reserved for error reporting; not currently wired into the API |

`GET /api/health` reports automation, payment-link and Google sign-in features so
the web app only offers what works. Resend is required for production login,
not an optional integration.

## Optional AWS Lambda deployment
From the repository root:

```bash
pnpm --filter api build  # → apps/api/dist/lambda/index.mjs (bundled ESM)
```
Create a Lambda (nodejs20.x, arm64, 512MB, 15s timeout), upload apps/api/dist/lambda/,
handler `index.handler`, enable a Function URL (auth NONE — the app does its
own auth), and set the six production env vars above, including Resend's
sender and key. Apply migrations with the same root command above before
deployments that require them. Build the web app with
`VITE_API_URL=<function url> pnpm --filter web build` only if it is not
served from the same origin.

## Conventions
- Every handler validates with @sorted/core zod schemas, scopes every query
  by userId, and returns plain rows (camelCase). Request bodies are snake_case.
  See handlers/bookings.ts (reference).
- Money is integer cents everywhere. Timestamps are timestamptz.
- Side-effects (WhatsApp/Calendar) never happen here — emit events instead
  (lib/events.ts).
