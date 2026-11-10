# API contract

Base URL: `/api`. Auth: `Authorization: Bearer <jwt>` on everything except
`/auth/*` and `/webhooks/*`. Internal routes use `X-Internal-Secret`.

All money is integer cents. All timestamps ISO 8601 UTC. Request bodies are
snake_case and validated by the zod schemas in `packages/core/src/types.ts`;
responses are DB rows with camelCase keys (interfaces in the same file). This
doc lists routes and semantics; the schemas are the source of truth for fields.
Errors are `{ "error": "message" }` (or a zod `flatten()` object for 400s).

`GET /health` (no auth) → `{ ok, features: { automation, paymentLinks } }` —
which integrations are configured, so the UI only offers what works.

## Auth
| Method | Path                | Notes |
|--------|---------------------|-------|
| POST   | /auth/magic-link    | body `{email}` → emails a 15-min login link (logged if no email provider; returned as `dev_link` in local dev) |
| POST   | /auth/verify        | body `{token}` → `{jwt, user}` |
| GET    | /auth/me            | current user |
| PATCH  | /auth/me            | business settings: `name`, `business_name`, `phone`, `review_link` |

## Clients
| Method | Path          | Notes |
|--------|---------------|-------|
| GET    | /clients      | list, `?q=` name search |
| POST   | /clients      | create (name required, rest optional — 10-second rule) |
| GET    | /clients/:id  | includes booking history + lifetime value |
| PATCH  | /clients/:id  | |
| DELETE | /clients/:id  | M8: GDPR cascade |

## Bookings
| Method | Path                    | Notes |
|--------|-------------------------|-------|
| GET    | /bookings               | `?from=&to=&status=` |
| POST   | /bookings               | inline client create supported: pass `client` object instead of `client_id` |
| GET    | /bookings/:id           | includes client, payments, message log |
| PATCH  | /bookings/:id           | field edits while enquiry/confirmed (409 after). Deposit is locked once confirmed |
| POST   | /bookings/:id/confirm   | enquiry→confirmed. Emits `booking.confirmed`. Creates deposit payment row if deposit_cents > 0 |
| POST   | /bookings/:id/complete  | confirmed→completed. Emits `booking.completed`. Creates balance payment row |
| POST   | /bookings/:id/cancel    | emits `booking.cancelled` |

## Payments
| Method | Path                     | Notes |
|--------|--------------------------|-------|
| GET    | /payments                | `?status=pending` = the "who owes me" view |
| POST   | /payments/:id/link       | creates Stripe Payment Link (503 if Stripe isn't configured), stores url, emits `payment.link_created` (n8n WhatsApps it) |
| POST   | /payments/:id/mark-paid  | manual: body `{method}` (cash/bank_transfer). Emits `payment.paid` |

## Expenses
| Method | Path                    | Notes |
|--------|-------------------------|-------|
| POST   | /expenses/receipts      | body `{content_type, data_base64}` (photo downscaled by the client, ≤1.5 MB) → `{receipt_key}`. Stored in Postgres for now |
| GET    | /expenses/:id/receipt   | the receipt image |
| POST   | /expenses               | optional `receipt_key`. `confirmed: true` + all four fields → a confirmed expense; otherwise `status=needs_review` (where OCR suggestions will land) |
| GET    | /expenses               | `?year=&category=&status=` |
| PATCH  | /expenses/:id           | confirm/correct OCR fields → `status=confirmed` |
| DELETE | /expenses/:id           | also deletes its receipt photo |

## Reports
| Method | Path                  | Notes |
|--------|-----------------------|-------|
| GET    | /reports/summary      | `?year=` → income, expenses, profit, by month + category (dashboard) |
| GET    | /reports/export       | `?year=&format=csv` → accountant export (income lines + expense lines) |

## Webhooks (no JWT)
| Method | Path              | Notes |
|--------|-------------------|-------|
| POST   | /webhooks/stripe  | verify signature; `checkout.session.completed` / `payment_link` events → mark paid, emit `payment.paid` |

## Internal (n8n → API, `X-Internal-Secret`)
| Method | Path                 | Notes |
|--------|----------------------|-------|
| POST   | /internal/messages   | n8n logs each WhatsApp send |
| GET    | /internal/reminders  | `?window_hours=24` → bookings needing a reminder (n8n cron polls this) |
| GET    | /internal/reviews    | bookings completed 2 days ago, review not yet requested |
| PATCH  | /internal/bookings/:id | n8n writes back `gcal_event_id`, `reminder_sent_at`, `review_requested_at` |

## Domain events (API → n8n webhook)

Single endpoint `N8N_WEBHOOK_URL`, JSON body:

```json
{
  "event": "booking.confirmed",
  "user": { "id": "...", "business_name": "...", "phone": "..." },
  "booking": { "...": "full booking incl. client" },
  "payment": { "optional, for payment.* events": true }
}
```

Events: `booking.confirmed`, `booking.completed`, `booking.cancelled`,
`payment.link_created`, `payment.paid`. Fire-and-forget with 2s timeout;
failures logged, never block the response.
