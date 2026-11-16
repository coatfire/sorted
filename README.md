# Sorted

**You do the work. We track the money.**

Business admin for sole traders who hate admin. Client log, WhatsApp automation,
payment links, expense capture, one-click year-end report.

## Repo layout

```
sorted/
├── docs/
│   ├── ARCHITECTURE.md        # System design + why each choice was made
│   ├── API.md                 # Full REST contract (implement against this)
│   ├── DATA_MODEL.md          # Entity reference + state machines
│   └── IMPLEMENTATION_PLAN.md # Ordered milestones with acceptance criteria ← START HERE
├── apps/
│   ├── api/                   # Hono API (Vercel, with a Lambda adapter)
│   └── web/                   # PWA frontend (Vite + React, mobile-first)
├── packages/
│   └── core/                  # Shared types, zod schemas, event definitions
└── automation/
    └── n8n/                   # Workflow specs (build these in the n8n UI)
```

## Quick start

```bash
pnpm install
pnpm dev        # API on :3001, web app on :5173
```

That's all — no accounts, no `.env`. Open http://localhost:5173 and either:

- **Explore the demo** — a seeded sample business that lives in your browser, or
- **Create an account with an email and password** — locally the verification link
  is shown on screen instead of emailed, and data is stored in an embedded Postgres under
  `apps/api/.data/`.

```bash
pnpm test       # API end-to-end tests (in-memory Postgres)
pnpm typecheck
pnpm build      # Lambda bundle + static PWA
```

Going to production (Supabase, Vercel, Stripe, email, n8n): see `apps/api/README.md`.
The root `vercel.json` serves the web and API in one Vercel project using
services. Leave `VITE_API_URL` unset so browser requests use the same origin.
Each integration switches on when its env vars are set, and the app only
offers what is actually connected.

## What works today

| | |
|---|---|
| Log a booking in one form, with a new or existing client | ✅ |
| Enquiry → confirmed → completed, with deposit and balance tracked | ✅ |
| "Owed to you", mark paid (cash / transfer) | ✅ |
| Card payment links, auto-marked paid by webhook | ✅ needs Stripe keys |
| Expenses with receipt photos, categories, edit/delete | ✅ |
| Year at a glance + Excel export for the accountant | ✅ |
| Send confirmations / payment links from your own WhatsApp | ✅ |
| Automatic WhatsApp confirmations, reminders, review requests | API ready; n8n workflows to build |
| Google Calendar sync, receipt OCR | not yet |

## How the code is organised

- `packages/core` — zod request schemas and response types shared by both
  apps. If the API and the web app disagree about a shape, core wins.
- `apps/api/src/handlers/*` — one file per resource; each validates with
  core, scopes every query by `userId`, and emits a domain event when
  automation should react. `bookings.ts` is the reference.
- `apps/web/src/lib/backend.ts` — the one seam between UI and data, with two
  implementations: `apiBackend` (the real API) and `demoBackend`
  (localStorage). Pages don't know which they have.
- n8n owns all side-effects (WhatsApp, Google Calendar, review requests). The
  API never talks to Meta or Google directly; it emits events. See
  `automation/n8n/README.md`.
- `docs/IMPLEMENTATION_PLAN.md` — the milestone list and what's left.

## Stack

| Layer      | Choice                          | Why (short version)                          |
|------------|---------------------------------|----------------------------------------------|
| API        | Hono on Vercel services         | Same-origin web + API; Lambda adapter retained |
| DB         | Supabase Postgres + Drizzle     | Transactions and SQL year-end aggregation      |
| Frontend   | Vite + React PWA                | Mobile-first, installable, no app-store tax   |
| Automation | n8n + Meta WhatsApp Cloud API   | Side-effects live outside the request path    |
| Payments   | Stripe Payment Links (Revolut later) | One integration to validate the flow     |

Full rationale in `docs/ARCHITECTURE.md`.

## Optional Google Drive backup

Set `GOOGLE_CLIENT_ID` to enable the manual Settings backup card; no client
secret is required for Drive (Google sign-in independently needs both).
Enable the Google Drive API in the Google Cloud project. In the **Web application**
OAuth client, add **`https://sorted-weld.vercel.app`** as an authorised JavaScript
origin, as previously requested. For local testing also add `http://localhost:5173`.
Configure the consent screen/test users as required by Google's publishing status.
The only requested Drive scope is `https://www.googleapis.com/auth/drive.file`.

The enabled Settings card preloads Google Identity Services and prepares its
token client. The button says “Getting ready…” and stays disabled until ready;
the tap then opens Google's popup synchronously. The browser keeps its
short-lived access token in memory only. PDFs use the existing renderer, photos
are copied in their original format, and yearly accountant CSVs use `exportFile`.
Files live in app-created Sorted folders, separated per Sorted account. Existing
PDFs/photos are skipped by name; CSVs are updated in place for every year with
financial data. No automatic backups, server-side Google tokens or refresh tokens.
Only a fully completed run records `drive_backed_up_at` (migration **0014**).
An empty account or a failed/cancelled run never advances the timestamp. Users
can remove their own backups in Drive; account deletion does not delete these copies.

CSP check: the repository currently sets no Content-Security-Policy in
`vercel.json`, the web HTML or API middleware. If a deployment adds one, allow
`https://accounts.google.com` for GIS scripts, connections and frames (and GIS
styles as needed), and `https://www.googleapis.com` for Drive connections. No
Google script is loaded when the feature is disabled or in demo mode. Opening
an enabled card prepares Google, but never opens a popup or starts a backup.
