# Data model

Canonical definitions live in code: `apps/api/src/db/schema.ts` (tables) and
`packages/core/src/types.ts` (shared types + zod). This doc is the narrative.

## Entities

### users
The sole trader. One row = one account = one business.
`id, email, name, business_name, phone, review_link, currency (default EUR),
created_at`

### clients
A person the trader works for. Phone is the WhatsApp identity — E.164, required
for automation to work, but nullable so a booking can be logged in 10 seconds
and the number added later.
`id, user_id, name, phone, email, notes, created_at`

### bookings
The centre of the model. Everything hangs off a booking.
`id, user_id, client_id, service, start_at, end_at, price_cents,
deposit_cents, status, location, notes, gcal_event_id, reminder_sent_at,
review_requested_at, completed_at, created_at`

**Status state machine:**

```
enquiry ──▶ confirmed ──▶ completed
   │            │
   └──────┬─────┘
          ▼
      cancelled
```

- `enquiry → confirmed` emits `booking.confirmed` (WhatsApp confirm + gcal event
  + deposit link if `deposit_cents > 0`)
- `confirmed`, 24h before `start_at`: n8n sends reminder (scheduled workflow,
  not an API event)
- `confirmed → completed` emits `booking.completed` (balance payment link;
  review request scheduled +2 days)
- any → `cancelled` emits `booking.cancelled` (gcal delete, optional WhatsApp)

### payments
Money expected or received against a booking.
`id, user_id, booking_id, kind (deposit|balance|full|custom),
amount_cents, method (stripe|revolut|cash|bank_transfer), status
(pending|paid|cancelled), stripe_payment_link_id, link_url, paid_at, created_at`

Rule: "what's owed at a glance" = `booking.price_cents − SUM(paid payments)`.
Marking paid can happen two ways: Stripe webhook, or manual tap (cash/transfer).
Both emit `payment.paid`.

### expenses
`id, user_id, merchant, amount_cents, category, expense_date, receipt_key,
ocr_raw (jsonb), status (needs_review|confirmed), created_at`

### receipts
Receipt photos, downscaled in the browser and stored as base64 in Postgres —
no bucket to provision for the MVP. `expenses.receipt_key` holds the receipt
id and is the only pointer, so moving to S3 later touches one handler.
`id, user_id, content_type, data_base64, created_at`

Categories (Irish sole-trader friendly, keep enum small):
`materials, travel, equipment, software, phone_internet, insurance,
training, marketing, other`

### message_log
Every WhatsApp message n8n sends, written back via `/internal/messages`.
`id, user_id, booking_id, client_id, channel, template
(confirmation|reminder|payment_request|review_request), status
(sent|delivered|failed), meta (jsonb), sent_at`

Gives the trader "what has my client been sent" and you a debugging trail.

## Derived data (never stored)

- Booking balance owed
- Monthly income / expenses / profit
- Year-end report: `SUM(payments WHERE status=paid AND paid_at IN year)` vs
  `SUM(expenses WHERE status=confirmed)` grouped by month + category → CSV

## Indexing notes

- `bookings (user_id, start_at)` — the calendar/list view query
- `payments (user_id, status)` — "what's owed" dashboard
- `expenses (user_id, expense_date)` — year-end range scan
