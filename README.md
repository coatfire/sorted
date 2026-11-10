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
│   ├── api/                   # AWS Lambda backend (TypeScript, Hono, Drizzle)
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
- **Log in with any email** — locally the login link is shown on screen
  instead of emailed, and data is stored in an embedded Postgres under
  `apps/api/.data/`.

```bash
pnpm test       # API end-to-end tests (in-memory Postgres)
pnpm typecheck
pnpm build      # Lambda bundle + static PWA
```

Going to production (Neon, Stripe, email, n8n): see `apps/api/README.md`.
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
| Year at a glance + CSV export for the accountant | ✅ |
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
| API        | Hono on AWS Lambda              | Tiny, fast, runs locally without emulation    |
| DB         | Postgres (Neon) + Drizzle       | Year-end report = SQL aggregation             |
| Frontend   | Vite + React PWA                | Mobile-first, installable, no app-store tax   |
| Automation | n8n + Meta WhatsApp Cloud API   | Side-effects live outside the request path    |
| Payments   | Stripe Payment Links (Revolut later) | One integration to validate the flow     |

Full rationale in `docs/ARCHITECTURE.md`.
