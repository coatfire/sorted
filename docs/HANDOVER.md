# Handover: from working MVP to a real, deployed app

You are picking up **Sorted**, a booking / payments / expenses app for sole
traders. This document tells you exactly what state it is in, what to build
next, in what order, and how to check each piece.

Read sections 1–5 fully before changing anything. Then do the tasks in
section 7 **in order, one task per pull request**.

---

## 1. Where things stand

**Works today, verified** (typecheck, 15 API tests, both builds, and a full
browser walkthrough):

- Log in by email link. Add / edit / confirm / complete / cancel bookings.
- Deposit and balance payments are created automatically; mark paid by cash
  or bank transfer; "Owed to you" list.
- Expenses with receipt photos, categories, edit, delete.
- Year summary and CSV export for the accountant.
- A demo mode that runs entirely in the browser.
- The production Lambda bundle (`apps/api/dist/index.mjs`) builds, loads and
  answers `GET /api/health`.

**Written but never run against the real service** — treat as untested:

- Stripe payment links and the Stripe webhook (`apps/api/src/handlers/payments.ts`,
  `webhooks.ts`).
- Login emails through Resend (`apps/api/src/handlers/auth.ts`).
- Anything on Neon. All testing used the embedded database.

**Not built:**

- Deployment (nothing is hosted anywhere).
- The n8n workflows that send WhatsApp messages. The API side is ready.
- Receipt OCR, Google Calendar sync, deleting a client.

**"Real working app" means:** a trader who is not the developer can open a
URL on their phone, log in from an email, run their bookings and money for a
month, and nothing is lost, double-charged, or sent to the wrong person.

---

## 2. Rules — do not break these

1. **Never weaken a check to get green.** Do not skip, delete or loosen a
   test, and do not add `any`, `@ts-ignore` or `as unknown as` to silence the
   type checker. (One `as unknown as` exists in `apps/api/src/db/index.ts`.
   Leave it; do not add more.)
2. **Every database query on user data must filter by `userId`.** Copy the
   pattern in `apps/api/src/handlers/bookings.ts`. A query without it leaks
   one trader's data to another.
3. **Money is integer cents.** Never store or add floats. Convert typed text
   with `parseEuros` (`apps/web/src/lib/format.ts`).
4. **The API never calls WhatsApp, Meta or Google.** It emits events
   (`apps/api/src/lib/events.ts`); n8n does the sending.
5. **Never put a secret in the repo, in a `VITE_` variable, or in a log
   line.** `VITE_` variables are shipped to every browser.
6. **Pages never call `fetch` or `api()` directly.** They call `backend.*`
   from `useStore()`. If you add a backend method you must add it in three
   places: `backend.ts` (interface), `apiBackend.ts`, `demoBackend.ts`.
7. **Do not change the status rules:** `enquiry → confirmed → completed`,
   and `enquiry` or `confirmed → cancelled`. Nothing else.
8. **Do not edit an existing file in `apps/api/drizzle/`.** Schema changes
   get a new migration (recipe in section 5).
9. **A button must only promise what will happen.** If automation is off,
   the UI must not say a message was sent. Use `features` from `useData()`.
10. **Do not redesign.** Keep the colours, fonts and layout. `docs/UI_SPEC.md`
    is the design authority.
11. **Stop and ask the human** whenever a task says "HUMAN", whenever you
    need an account, key, domain or payment, and whenever a step would
    delete data or send a message to a real person.

---

## 3. Run and verify

```bash
pnpm install
pnpm dev          # API on http://localhost:3001, web on http://localhost:5173
pnpm typecheck
pnpm test
pnpm build
```

No `.env` is needed locally. With no `DATABASE_URL` the API uses an embedded
Postgres stored in `apps/api/.data/`. Delete that folder to start clean.

To log in locally: enter any email, then press **Open login link** on the
next screen. No email is sent in local mode.

**Before every commit, all three must pass:** `pnpm typecheck`, `pnpm test`,
`pnpm build`. CI runs the same three (`.github/workflows/ci.yml`).

**For any change to the web app, also check it by hand** at a 390px-wide
window: do the thing you changed, in both a logged-in session and the demo,
and confirm the browser console shows no errors.

---

## 4. Map of the code

```
packages/core/src/types.ts     zod schemas for request bodies + response types. Shared.
packages/core/src/events.ts    shape of events sent to n8n.

apps/api/src/app.ts            routes are mounted here; error handler; /health.
apps/api/src/lib/env.ts        ALL environment variables are read here, nowhere else.
apps/api/src/lib/auth.ts       JWT issue/verify; requireAuth; requireInternalSecret.
apps/api/src/lib/events.ts     emitEvent / emitBookingEvent → n8n webhook.
apps/api/src/db/schema.ts      tables.
apps/api/src/db/index.ts       picks Neon (DATABASE_URL set) or embedded Postgres.
apps/api/src/handlers/*.ts     one file per resource. bookings.ts is the reference.
apps/api/drizzle/              generated SQL migrations. Commit them.
apps/api/test/flow.test.ts     end-to-end API tests. Add yours here.

apps/web/src/lib/backend.ts    the interface every page uses for data.
apps/web/src/lib/apiBackend.ts real implementation (calls the API).
apps/web/src/lib/demoBackend.ts demo implementation (localStorage).
apps/web/src/lib/store.tsx     useSession, useStore, useData, useAction.
apps/web/src/lib/format.ts     money, dates, labels, WhatsApp links.
apps/web/src/components.tsx    Button, Card, Field, Sheet, EmptyState, Icon…
apps/web/src/pages/*.tsx       one file per screen.
apps/web/src/styles.css        all styles. Colours are variables at the top.
```

Two facts that surprise people:

- **Request bodies are `snake_case`; responses are `camelCase`.** Responses
  are database rows returned as-is.
- **The web app loads everything in one go** (`backend.load()` returns a
  `Snapshot`) and reloads it after every change. Pages read from the snapshot
  with `useData()`. There is no per-page fetching except the message log on
  the booking screen.

---

## 5. Recipes

### Add or change an API route

1. If it takes a body, add a zod schema to `packages/core/src/types.ts`.
2. In the handler: `safeParse` the body, return `400` with
   `{ error: parsed.error.flatten() }` on failure.
3. Filter every query by `c.get("userId")`.
4. Return the row. Errors are `{ error: "plain sentence" }` with a 4xx code.
5. Add a test in `apps/api/test/flow.test.ts`. Include one test that a
   *second* user gets `404` for the first user's record.
6. Add the route to `docs/API.md`.

### Add something to the web app

1. Add the method to the `Backend` interface in `backend.ts`.
2. Implement it in `apiBackend.ts` **and** `demoBackend.ts`.
3. In the page, run it through `useAction()`:

   ```tsx
   const { backend } = useStore();
   const { busy, run } = useAction();
   <Button disabled={busy} onClick={() => run(() => backend.doThing(id), "Thing done")}>
   ```

   `run` disables the button, reloads data, shows the success toast, and
   shows the error toast if it fails. Do not write your own try/catch.

### Change the database

1. Edit `apps/api/src/db/schema.ts`.
2. `pnpm --filter api db:generate` — creates a new file in `apps/api/drizzle/`.
3. Read the generated SQL. If it drops a column or table you did not mean
   to drop, stop.
4. Commit the schema change and the new migration together.
5. Local and test databases apply migrations automatically. Production does
   not: the human runs `pnpm --filter api db:migrate`.

---

## 6. What the human must provide

You cannot create these. Ask for them when the task needs them, not before.

| Needed for | What to ask for |
|---|---|
| Task 6 | A Neon project and its `DATABASE_URL` |
| Task 6 | An AWS account (or agreement on another host) and a domain |
| Task 6 | A Resend account, API key, and a verified sending domain |
| Task 7 | Stripe **test** secret key and webhook signing secret |
| Task 8 | An n8n instance, and a Meta WhatsApp Business account with approved templates |
| Task 9 | An Anthropic API key |

---

## 7. Tasks, in order

Tasks 1–5 need no accounts. Do them first. Each is one pull request.

### Task 1 — Make payment links safe to use with real money

**Why.** Three ways a client can be charged wrongly today:
(a) a Stripe Payment Link can be paid more than once;
(b) when a payment is voided (booking cancelled, or a deposit replaced by a
balance on completion) or marked paid by hand, its link stays live;
(c) the webhook marks a payment paid even if it was already voided.

**Files.** `apps/api/src/handlers/payments.ts`, `webhooks.ts`, `bookings.ts`;
new file `apps/api/src/lib/stripe.ts`.

**Steps.**

1. In `payments.ts`, where `stripe.paymentLinks.create` is called, limit the
   link to one successful payment. In the Stripe API this is
   `restrictions: { completed_sessions: { limit: 1 } }`. **Check the current
   Stripe API reference for Payment Links before writing it** and use
   whatever the installed `stripe` package's types accept.
2. Create `lib/stripe.ts` exporting `deactivatePaymentLink(linkId)`. It does
   nothing if `env.stripeKey()` is unset, otherwise calls
   `stripe.paymentLinks.update(linkId, { active: false })`. Wrap it in
   try/catch and `console.error` on failure — it must never throw.
3. Call it for each affected payment that has a `stripePaymentLinkId`:
   - in `mark-paid` after the update;
   - in `bookings.ts` `complete` and `cancel`. Those run one `UPDATE` that
     voids pending payments; add `.returning()` to it and loop the result.
4. In `webhooks.ts`, only mark paid when the payment's status is `pending`.
   If it is `cancelled`, do **not** change it; `console.error` a line with
   the payment id and the Stripe session id so the human can refund. Still
   return `200 { received: true }`.

**Done when.** `pnpm test` passes (existing tests must not change behaviour).
Stripe itself cannot be tested in CI; it is tested by hand in Task 7. Say so
in the PR.

**Don't.** Do not add a Stripe mock library. Do not change what `mark-paid`
or `complete` return.

### Task 2 — Login links: single use and rate limited

**Why.** A login link currently works any number of times for 15 minutes,
and anyone can make the server send unlimited emails to any address.

**Files.** `apps/api/src/db/schema.ts`, `lib/auth.ts`, `handlers/auth.ts`,
`test/flow.test.ts`, `apps/web/src/pages/Login.tsx` (error text only).

**Steps.**

1. New table `login_tokens`: `id` uuid primary key default random, `email`
   text not null, `created_at` timestamptz default now, `used_at` timestamptz
   nullable. Index on `email`. Generate the migration (recipe above).
2. In `POST /auth/magic-link`, before creating a token: count rows for this
   email with `created_at` in the last 15 minutes. If 3 or more, return `429`
   with `{ error: "Too many login links requested. Check your email, or try again in 15 minutes." }`.
3. Insert a `login_tokens` row. Put its `id` in the JWT as the `jti` claim
   (`.setJti(id)` in `issueMagicLinkToken` — change that function to take the
   id).
4. In `verifyMagicLinkToken` / `POST /auth/verify`: read `payload.jti`. Run
   one statement: `UPDATE login_tokens SET used_at = now() WHERE id = jti AND
   used_at IS NULL RETURNING id`. If it returns no row, respond `401` exactly
   as for an expired link. Doing it as one `UPDATE … RETURNING` is what makes
   it safe if two requests arrive together.
5. One existing test calls `issueMagicLinkToken(user.id)` directly. Update it
   to match the new signature; it must still prove that a magic-link token is
   rejected as a session token.
6. Add tests: the same link works once and fails the second time; the fourth
   request inside 15 minutes gets `429`.

**Done when.** New tests pass, and logging in locally in the browser still
works. Note: in development React runs effects twice; `Login.tsx` already
guards against double verification with a ref. Do not remove that guard.

### Task 3 — Accessibility pass (WCAG 2.2 AA)

**Why.** Measured failures exist. Fix exactly these; do not restyle anything
else. All in `apps/web/src/styles.css` unless stated.

**Contrast** (must be at least 4.5:1). Measured today → replacement:

| What | Where | Now | Change to | Result |
|---|---|---|---|---|
| Secondary text | `--muted` | `#70756f` (4.38 on the page background) | `#676c66` | 4.99 |
| Placeholder text | `input::placeholder, textarea::placeholder` | `#a4a8a1` (2.35) | `#6f746d` | 4.64 |
| Inactive tab label | `.tabbar a` | `#81857f` (3.75) | `var(--muted)` | passes |
| Amber "due" text | `--due` | `#a65d16` (4.53, no margin) | `#985313` | 5.31 |

After changing `--muted`, look at every screen once: it is used widely and
should look the same, only very slightly darker.

**Text size.** Nothing interactive or informative below `0.7rem`. Search for
`font-size: 0.6` (12 places) and raise each to `0.7rem`. Check the status
chips and tab labels still fit on a 390px screen.

**Tap targets** (must be at least 44px tall). Raise `min-height` to `44px` on:
`.suggestion-row button, .category-row button` · `.reveal-button, .text-link,
.back-button` · `.banner-demo button` · `.chip-link`. If a row gets taller and
looks wrong, add vertical padding to its container rather than shrinking the
target again.

**Keyboard and screen reader.**

1. `Sheet` in `apps/web/src/components.tsx` closes on Escape but does not
   trap focus. Make Tab and Shift+Tab cycle inside the sheet while it is open.
2. The receipt zoom (`.lightbox` in `pages/Expenses.tsx`) is a clickable
   `div`. Make it close on Escape, move focus into it when it opens, and
   return focus to the thumbnail when it closes.
3. Form errors: when a form shows `.form-error`, give the message an `id`
   and set `aria-invalid="true"` and `aria-describedby` on the field it is
   about. Apply to `BookingForm`, `Expenses`, `ClientDetail`, `Settings`,
   `Login`.
4. Confirm every button that shows only an icon has an `aria-label`.

**Done when.** With the keyboard only you can: log in, add a booking, mark a
payment paid through the sheet, and add an expense. Focus is always visible.
`prefers-reduced-motion` is already handled at the bottom of `styles.css`;
leave it.

### Task 4 — Validate fields when the user leaves them

**Why.** Today every form reports problems only on submit, one at a time.

**Files.** `pages/BookingForm.tsx`, `pages/Expenses.tsx`,
`pages/ClientDetail.tsx`, `pages/Settings.tsx`.

**Steps.**

1. Validate a field `onBlur`, never on each keystroke. Clear that field's
   error as soon as the user edits it again.
2. Show the error directly under the field it belongs to (the `Field`
   component already has a `helper` slot; add an `error` prop that renders in
   the error style and wires up the `aria-` attributes from Task 3).
3. On submit, validate everything, show all errors, and move focus to the
   first field with an error.
4. Keep the existing error sentences. They already say what to do
   ("Add the price, like 120 or 120.50.").

**Don't.** Do not change the order of fields, the field names sent to the
API, or the `sticky-action` behaviour in `BookingForm` (two earlier commits
fixed the Save button covering the error; keep `has-error` working).

### Task 5 — Delete a client (GDPR)

**Why.** `DELETE /api/clients/:id` returns `501`. A trader must be able to
remove a client's personal data.

**HUMAN decision first — ask before coding:** payments already received are
tax records and feed the year-end export. Recommended behaviour, to confirm:

- Client has **no paid payments** → delete the client and everything under
  it.
- Client has **paid payments** → keep the bookings and payments, but
  anonymise: set name to `Deleted client`, and phone, email, notes to null;
  delete their rows in `message_log`; clear `notes` and `location` on their
  bookings.

**Steps (once confirmed).**

1. Require body `{ "confirm": true }`; otherwise `400`.
2. Refuse with `409` if the client has a booking in `enquiry` or `confirmed`
   ("Cancel or complete their open bookings first.").
3. Delete in this order, each filtered by `userId`: `message_log` → `payments`
   → `bookings` → `clients`. Receipts are not linked to clients; do not touch
   them.
4. The production database driver has no multi-statement transactions (see
   section 8). The order above is safe to re-run if it stops half-way; keep it
   that way.
5. Web: add `deleteClient` to the backend (three places), and a "Delete
   client" action on `pages/ClientDetail.tsx` that opens a `Sheet` stating
   plainly what will be removed, then returns to Today.
6. Tests: delete without paid payments removes everything; with paid
   payments anonymises and the year summary total is unchanged; another user
   gets `404`.

### Task 6 — Deploy (HUMAN supplies accounts; you do the steps with them)

Do these in order. Stop at each "HUMAN" line.

1. **Database.** HUMAN creates a Neon project and gives you `DATABASE_URL`.
   Run `DATABASE_URL=… pnpm --filter api db:migrate`. It must be a **new,
   empty** database. If it was previously set up with the old `db:push`
   command, stop: the first migration will fail on existing tables, and the
   human must choose between starting empty or baselining.
2. **API.** `pnpm --filter api build`. Create a Lambda: Node.js 20, arm64,
   512 MB, 15 s timeout, handler `index.handler`, upload `dist/index.mjs`,
   enable a Function URL with auth `NONE`. Environment variables:
   `DATABASE_URL`, `JWT_SECRET` (HUMAN generates 32+ random characters),
   `APP_URL` (the web address, no trailing slash), `CORS_ORIGIN` (same value
   as `APP_URL`), `RESEND_API_KEY`, `EMAIL_FROM`.
   Check: `GET <function-url>/api/health` returns `{"ok":true,…}`.
3. **Web.** Build with the API address baked in:
   `VITE_API_URL=<function-url> pnpm --filter web build`. Host
   `apps/web/dist` as a static site. **The host must serve `index.html` for
   any path that is not a file** (single-page-app fallback) or login links
   (`/login?token=…`) will show a 404.
4. **Email.** HUMAN verifies the sending domain in Resend. Request a login
   link for a real inbox and confirm it arrives and logs in.
5. **Smoke test on a real phone**, in this order: log in from the email →
   set business name → add a booking with a new client and a deposit →
   confirm → mark deposit paid (cash) → mark complete → mark balance paid →
   add an expense with a photo → export CSV and open it → log out → log in
   again and confirm everything is still there → install to home screen.
6. Write what you did, with the exact commands, into `apps/api/README.md`.

**Check for leaked local behaviour:** on the deployed site the "Check your
email" screen must **not** show an "Open login link" button. That button is
only for local development. If it appears, stop and report it.

### Task 7 — Stripe, end to end (HUMAN supplies test keys)

Read section 8, "Whose Stripe account", before starting — the human must
decide that first.

1. Set `STRIPE_SECRET_KEY` (test mode). In Stripe, add a webhook endpoint
   `<function-url>/api/webhooks/stripe` for the event
   `checkout.session.completed`; set its signing secret as
   `STRIPE_WEBHOOK_SECRET`.
2. Settings in the app should now show "Card payment links: Connected".
3. Complete a booking, press **Payment link**, open the link, pay with test
   card `4242 4242 4242 4242`. Within a few seconds the payment must show
   **Paid** in the app without touching it.
4. Try to pay the same link again — it must be refused (Task 1).
5. Cancel a different booking that has a link — its link must stop working.
6. Report each of the five results in the PR.

### Task 8 — WhatsApp automation with n8n (HUMAN supplies n8n + Meta)

The full specification already exists: `automation/n8n/README.md`. Follow it
exactly; do not redesign it. Notes that will save you time:

- Meta template approval takes days. HUMAN must submit the four templates
  first; nothing can be tested before that.
- Set `N8N_WEBHOOK_URL` and `INTERNAL_SECRET` on the API. Settings then
  shows "WhatsApp messages: Connected" and confirm buttons change to
  "Confirm & notify <name>".
- n8n calls back with header `X-Internal-Secret`. The routes are in
  `apps/api/src/handlers/internal.ts`: `POST /internal/messages`,
  `GET /internal/reminders?window_hours=24`, `GET /internal/reviews`,
  `PATCH /internal/bookings/:id`.
- Event shapes are in `packages/core/src/events.ts`.
- Use the human's own phone number as the client for all testing.
- Export each finished workflow as JSON into `automation/n8n/`.

**Done when.** Confirming a booking for the human's own number delivers a
WhatsApp message, and it appears under "Client messages" on the booking.

### Task 9 — Receipt OCR (HUMAN supplies Anthropic key)

**Goal.** After a receipt photo is taken, pre-fill merchant, amount, date and
category. The user still presses **Confirm expense** — OCR must never save an
expense by itself.

1. API: `POST /api/expenses/receipts/:receiptKey/scan`. Load the receipt
   (filter by `userId`), send the image to a Claude vision model, ask for
   JSON with `merchant`, `amount_cents`, `expense_date` (ISO date), `category`
   (one of the `ExpenseCategory` values) and allow `null` for any it cannot
   read. Validate the reply with zod. Return it. Do not write to `expenses`.
   **Read the current Anthropic API documentation** for the model name and
   the image message format; do not guess them.
2. If `ANTHROPIC_API_KEY` is unset return `503`, and add `ocr: boolean` to
   the `features` object in `GET /health` (and to the `Health` type in core).
3. Web: `createExpense` in `apiBackend.ts` currently uploads the photo and
   creates the expense in one step. Split it: upload on photo pick, call
   scan if `features.ocr`, fill only the fields that are still empty, and
   move focus to the first field that came back `null`.
4. The demo backend returns no suggestions.
5. Timeout the model call at 10 seconds; on failure show the empty form with
   no error — typing it in is the fallback.

### Task 10 — Know when it breaks

Add error reporting (Sentry or similar; HUMAN picks and supplies the key) in
two places: `app.onError` in `apps/api/src/app.ts`, and a React error
boundary around `<Routes>` in `apps/web/src/main.tsx` that shows "Something
broke — reload" with a reload button. Never send request bodies, phone
numbers, names or tokens to the error service.

---

## 8. Known limits and decisions for the human

Do not "fix" these on your own. Raise them.

- **Whose Stripe account.** There is one `STRIPE_SECRET_KEY` for the whole
  deployment, so every trader's card payments land in that one Stripe
  account. That is fine for a single-trader beta using their own key. For
  more than one trader it is wrong and needs Stripe Connect — a significant
  piece of work, not a tweak.
- **No transactions.** The production driver (Neon over HTTP) runs one
  statement at a time. Confirm, complete and cancel each do two or three
  writes; a crash between them can leave, for example, a completed booking
  with no balance row. Rare, but real. The fix is switching to Neon's
  WebSocket driver, which changes `db/index.ts` and needs retesting
  everything.
- **Deposit links are not sent automatically.** Confirming creates the
  deposit payment, but the trader has to press **Payment link** to create and
  send it. `docs/DATA_MODEL.md` implies it is automatic. Decide which is
  wanted.
- **Events are fire-and-forget.** If n8n is down when a booking is confirmed,
  that message is never sent and nothing retries.
- **Receipt photos live in Postgres** as base64 (about 150 KB each). Fine for
  a beta. Move to S3 when the database size starts to matter; only
  `handlers/expenses.ts` needs to change.
- **Year boundaries use UTC in the API export and local time in the app.** A
  payment at 00:30 on 1 January Irish time can fall in different years in the
  two places. Low impact; fix before the first real January.
- **The session token is in `localStorage`** and lasts 30 days. Acceptable
  for a beta; revisit before wider release.
- **Offline is read-only.** The last loaded data is shown; changes made
  offline fail with a message and are not queued.
- **Desktop shows a phone-width column.** Intentional for now.
- **Everything loads at once.** Fine up to a few thousand bookings per
  trader.

---

## 9. When you are stuck

- A test fails and you do not understand why → read the test, then the
  handler it calls. Do not change the test to match your code unless the task
  told you the behaviour should change.
- Something works locally but not deployed → check, in this order: the env
  vars on the Lambda, `CORS_ORIGIN` matches the web address exactly, the web
  build was made with `VITE_API_URL`, the static host has the single-page-app
  fallback.
- You are unsure whether a change is in scope → it is not. Finish the task
  as written and list the idea in the PR description.
