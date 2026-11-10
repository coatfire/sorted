# Implementation plan

Ordered by dependency. Each milestone is shippable and has acceptance criteria.
Don't start a milestone until the previous one's criteria pass. Estimates assume
evenings/weekends solo pace.

Reference implementation: `apps/api/src/handlers/bookings.ts` is fully written.
Every stub says `// TODO(M#)` with the milestone it belongs to.

## Where things stand

Built and working end to end (web ↔ API, covered by `pnpm test`):
M0, M1, M2 (Stripe code paths are written but need your test keys to try),
M6, and from M8: emailed login links (Resend), offline shell, first-run nudge.
Also done ahead of plan: client page, booking edit, receipt photos (stored in
Postgres rather than S3), `wa.me` hand-off so confirmations and payment links
can be sent from your own WhatsApp before Meta approval lands.

Still to do: M3/M4/M7 (n8n workflows — the API side is ready), M5's OCR,
and the rest of M8 (deploy, GDPR client delete, error tracking).

The checklists below are the original plan, kept for the acceptance criteria.

---

## M0 — Repo runs (½ day)
- [ ] `pnpm install` at root succeeds
- [ ] Neon project created, `DATABASE_URL` in `apps/api/.env`
- [ ] `pnpm --filter api db:migrate` creates all tables
- [ ] `pnpm --filter api dev` → `GET /api/health` returns `{ok:true}`
- [ ] `pnpm --filter web dev` → PWA shell loads, hits health endpoint

**Accept:** screenshot of PWA showing "API connected".

## M1 — Clients + Bookings CRUD (2–3 days)
The 10-second client log. No automation yet.
- [ ] Auth: magic link (console-logged link is fine), JWT middleware
- [ ] Implement handlers: `clients.ts` (all), `bookings.ts` list/get/patch
      (create + confirm already written as reference)
- [ ] Web: Add Booking screen — one form, inline new-client, big Save button
- [ ] Web: Today/Upcoming list (the home screen), booking detail
- [ ] Booking status transitions enforced (see DATA_MODEL.md state machine)

**Accept:** on a phone, add a real booking with a new client in under 30 seconds.

## M2 — Payments + Stripe (2–3 days)
- [ ] Confirm/complete transitions create payment rows (deposit/balance)
- [ ] `POST /payments/:id/link` → real Stripe Payment Link
- [ ] Stripe webhook verifies signature, marks paid
- [ ] Manual mark-paid (cash/transfer)
- [ ] Web: "Owed to you" list; payment buttons on booking detail

**Accept:** complete a test booking, pay the link with a Stripe test card,
see it flip to paid without touching the app.

## M3 — n8n + WhatsApp automation (3–4 days, the risky one)
- [ ] Meta Cloud API: business verification, test number, message templates
      submitted for approval (**start template approval on day 1 of M3 — it
      takes days and blocks everything**)
- [ ] Build workflows from `automation/n8n/*.md`: event router, reminder cron,
      review cron
- [ ] API event emitter (`lib/events.ts`) pointed at n8n webhook
- [ ] `/internal/*` routes implemented; message_log populates
- [ ] Web: message history visible on booking detail

**Accept:** confirm a booking for your own phone number → WhatsApp confirmation
arrives; fake a booking 23h out → reminder arrives on cron.

## M4 — Google Calendar sync (1–2 days)
- [ ] Google OAuth in n8n (trader connects their own calendar — store per-user
      credential; MVP: single beta user hardcoded, note the multi-user TODO)
- [ ] `booking.confirmed` → gcal event created, id written back
- [ ] `booking.cancelled` → gcal event deleted

**Accept:** confirmed booking appears in Google Calendar within seconds.

## M5 — Expense capture + OCR (2–3 days)
- [ ] S3 bucket + presigned upload
- [ ] OCR via vision model, returns suggestions, `needs_review` flow
- [ ] Web: camera capture → snap → confirm screen (edit 4 fields, one tap)
- [ ] Expense list with category filter

**Accept:** photograph a real receipt; confirmed expense has correct merchant,
amount, date with ≤1 field corrected.

## M6 — Reports + year-end export (1–2 days)
The retention feature. Make it feel great.
- [ ] `/reports/summary`: monthly income/expenses/profit + category breakdown
- [ ] `/reports/export` CSV an accountant would accept
- [ ] Web: simple dashboard (this year at a glance), big Export button

**Accept:** export a CSV of test data, open in Excel, an accountant-shaped
person says "yes I could use this".

## M7 — Review requests (½ day)
- [ ] Review cron workflow live (`/internal/reviews` already built in M3)
- [ ] User setting: Google review link
- [ ] Toggle per booking to skip

**Accept:** completed booking triggers review WhatsApp 2 days later.

## M8 — Beta hardening (ongoing)
- [ ] Real magic-link email (Resend/SES)
- [ ] Deploy: API to Lambda (see `apps/api/README.md`), web to Cloudflare
      Pages/S3, custom domain
- [ ] PWA installability (manifest done — verify Lighthouse), offline shell
- [ ] GDPR delete-client cascade
- [ ] Error tracking (Sentry), basic analytics (PostHog)
- [ ] Onboarding: first-run wizard (business name, phone, review link, connect
      calendar)

**Accept:** wife's first vendor onboards themselves without you on the phone.

---

## Sequencing notes

- M1+M2 alone are already useful (log bookings, send payment links by copy-
  paste). If WhatsApp template approval drags, beta can start on M2.
- Revolut, voice-note expenses (Cartesia), and web enquiry forms are
  deliberately post-beta. Don't touch until 5 vendors use the core loop weekly.
- Pricing/billing (Stripe subscriptions for the €29) is absent on purpose —
  beta is free; add in month 2–3 once retention is proven.
