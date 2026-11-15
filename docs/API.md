# API contract

Base URL: `/api`. Auth: `Authorization: Bearer <jwt>` on everything except
`/auth/*` and `/webhooks/*`. Internal routes use `X-Internal-Secret`.

All money is integer cents. All timestamps ISO 8601 UTC. Request bodies are
snake_case and validated by the zod schemas in `packages/core/src/types.ts`;
responses are DB rows with camelCase keys (interfaces in the same file). This
doc lists routes and semantics; the schemas are the source of truth for fields.
Errors are `{ "error": "message" }` (or a zod `flatten()` object for 400s).

`GET /health` (no auth) → `{ ok, features: { automation, paymentLinks, googleSignIn } }` —
which integrations are configured, so the UI only offers what works.

## Auth

### Google sign-in (optional)

Only enabled when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set;
otherwise `features.googleSignIn` is false and start/exchange return 404.

- `GET /auth/google/start`: full-page redirect to Google's OpenID Connect
  authorization endpoint (`openid email profile`, account selection, S256 PKCE).
  A signed, HttpOnly, Secure, SameSite=Lax cookie holds state, nonce and verifier
  for ten minutes, scoped to `/api/auth/google`. Redirect URI is
  `{API_URL or APP_URL}/api/auth/google/callback`.
- `GET /auth/google/callback`: clears the cookie, checks state, exchanges the
  authorization code and verifies Google's RS256 ID token against Google's
  JWKS, accepted Google issuers, client audience, expiry and nonce. Email must
  be verified. Resolves Google subject first, then case-insensitive email;
  links that account and verifies it, or creates a verified passwordless user.
  Existing passwords are untouched. An account linked to a different Google
  subject is not reassigned.
- Success redirects to `{APP_URL}/login/google?code=…` with an opaque single-use
  two-minute code, **never a session JWT**. Only its SHA-256 hash is stored in
  `login_codes`, bound to the user's session version. The callback also generates
  a random browser binding: its SHA-256 hash is stored alongside the code, and
  the value is put in a separate HttpOnly, Secure, SameSite=Lax cookie scoped
  to `/api/auth/google` for 120 seconds.
- `POST /auth/google/exchange`, body `{code}`, requires that browser-binding
  cookie and atomically consumes a code only when both hashes match, then clears
  the binding cookie and returns the usual `{jwt,user}`. The web explicitly sends
  credentials on this request (the production API and web share an origin).
  Missing or mismatched cookies return the same generic 401 without consuming
  the code, so forwarding a login link cannot sign another browser in.
  Invalid, expired, used or revoked codes also return 401. Pre-0013 codes with
  no binding are rejected; restart Google sign-in to obtain a bound code.
  Start and exchange each allow ten attempts per proxy-reported IP per fifteen
  minutes; exchange returns 429 when limited. Deploy behind a trusted proxy
  which sets `X-Forwarded-For` (otherwise callers share the fallback limit).

Callback/start failures redirect to `{APP_URL}/login?error=google`. The web
also redirects there on exchange failure. OAuth routes use no-store and
no-referrer headers and are excluded from request logging; provider responses,
tokens, credentials and codes are never logged. Public user responses omit
the Google subject. New users complete the existing profile onboarding.

### Email and password
| Method | Path                | Notes |
|--------|---------------------|-------|
| POST   | /auth/signup        | body `{email,password}` → `{ok:true}`; emails a 15-min verification link, or an account reminder with `/forgot` for existing verified accounts |
| POST   | /auth/verify        | body `{token}` → `{jwt,user}`; consumes a verification token and applies its pending password exactly once |
| POST   | /auth/login         | body `{email,password}` → `{jwt,user}`; verified accounts with a password only |
| POST   | /auth/forgot        | body `{email}` → `{ok:true}`; emails a 15-min reset link if the account exists |
| POST   | /auth/reset         | body `{token,password}` → `{jwt,user}`; consumes a reset token exactly once and verifies the email if needed |
| GET    | /auth/me            | current user |
| PATCH  | /auth/me            | business settings: `name`, `business_name`, `phone`, `review_link`, `address`, `iban`, `bic` |

Verification and reset links expire after 15 minutes and are single-use, including simultaneous
verification attempts. Expired, already-used, or invalid links return
`401 { "error": "Invalid or expired login link" }`.

Signup and forgot share a limit of three requests per email address (case-insensitive)
within the last 15 minutes. The fourth returns
`429 { "error": "Too many login links requested. Check your email, or try again in 15 minutes." }`.
Used links still count toward this limit.

Passwords use salted scrypt and must be at least 8 characters. Ten failed logins
within 15 minutes block further checks with 429; invalid credentials always return
`401 { "error": "Email or password is incorrect." }`. User responses omit password hashes.
IBANs are uppercased, stripped of spaces and checked with mod-97; BICs are uppercased
and must contain 8 or 11 alphanumeric characters. Null clears either optional field.

Local email failures log and return `dev_link`. Production failures delete the
new token and return `502 { "error": "We couldn't send your login email. Try again in a minute." }`,
without logging the link. Signup/forgot otherwise return the same success response
regardless of account existence; development links are never returned in production.

## Clients
| Method | Path          | Notes |
|--------|---------------|-------|
| GET    | /clients      | list, `?q=` name search |
| POST   | /clients      | create (name required, rest optional — 10-second rule) |
| GET    | /clients/:id  | includes booking history + lifetime value |
| PATCH  | /clients/:id  | |
| DELETE | /clients/:id  | requires `{ "confirm": true }` (otherwise 400); 409 for enquiry/confirmed bookings. Deletes clients without paid payments; otherwise anonymises personal data and retains bookings/payments for tax records. Returns `{ "outcome": "deleted" }` or `{ "outcome": "anonymised" }`. Receipts are unchanged. |

## Bookings

### Quotes and repeat enquiries

`POST /bookings/:id/documents` accepts `{ kind: "quote" }` alongside invoice
and receipt. A quote is an enquiry's PDF, not a separate entity. The booking
must belong to the user (404 otherwise) and still be an enquiry (409 otherwise,
including re-downloads). One number and issue time are allocated per booking;
the per-user quote sequence is independent of invoices/receipts and displayed
as QTE-0001. The quote always uses the booking's current price. Like invoices,
its VAT rate is captured when first numbered. Validity is the Ireland-local
issue date plus 30 calendar days.

`POST /bookings` optionally accepts `repeat: { every_weeks: 1 | 2 | 4,
count: 2..12 }`. Count is the total, including the first booking. All enquiries
and an optional inline client are created in one transaction. Dates and optional
start times shift by calendar weeks in Europe/Dublin, not fixed UTC durations.
Optional end times preserve the original duration relative to each shifted start.
Only the first gets `follow_up_on` (including the normal two-day default);
later bookings get null. The response is the first booking with `seriesCount`
(1 without repeat). No confirmations, payments or messages are created.
Invalid intervals/counts return 400 without creating anything.

During a skipped spring-clock hour, the time moves forward by the clock gap;
ambiguous autumn times preserve the original offset when possible.


Bookings include `followUpOn` (nullable YYYY-MM-DD) and `paymentRequestedAt`
(nullable UTC timestamp). Create/PATCH accept `follow_up_on`: a valid calendar
date, or null to remove the follow-up. Omitted on creation defaults to two days
after today in Europe/Dublin; omitted on PATCH preserves it. Only enquiries
may be assigned a follow-up date. Confirming or cancelling clears it.

`POST /bookings/:id/payment-requested` (authenticated, no body) records the
current time in `paymentRequestedAt` and returns the booking. Missing or foreign
bookings return 404. It emits no event and creates no message-log entry: opening
a draft is not proof the user sent it. All payment-request draft actions call
this endpoint, including reminders from Money.

Today selects enquiries with `followUpOn <= today` in Europe/Dublin, oldest
follow-up date first. Rescheduling uses PATCH with `follow_up_on`.

| Method | Path                    | Notes |
|--------|-------------------------|-------|
| GET    | /bookings               | `?from=&to=&status=` |
| POST   | /bookings               | inline client create supported: pass `client` object instead of `client_id` |
| GET    | /bookings/:id           | includes client, payments, message log |
| PATCH  | /bookings/:id           | field edits while enquiry/confirmed (409 after). Deposit is locked once confirmed |
| POST   | /bookings/:id/confirm   | enquiry→confirmed. Emits `booking.confirmed`. Creates deposit payment row if deposit_cents > 0 |
| POST   | /bookings/:id/complete  | confirmed→completed. Emits `booking.completed`. Creates balance payment row |
| POST   | /bookings/:id/cancel    | emits `booking.cancelled` |

## Calendar

| Method | Path | Notes |
|--------|------|-------|
| GET | /calendar | Authenticated. Lazily creates a secret 32-byte base64url token. Returns `{ confirmed: { https, webcal, google }, enquiries: { https, webcal, google } }`. Google URLs use the encoded webcal URL as `cid`. |
| POST | /calendar/reset | Authenticated. Rotates the token and returns new URLs in the same shape. Old links immediately return 404. No body required. |
| GET | /calendar/:token/confirmed.ics | Public bearer-link feed: confirmed + completed bookings belonging to the token owner. |
| GET | /calendar/:token/enquiries.ics | Public bearer-link feed: enquiries belonging to the token owner. |

Feeds include bookings starting from 180 days ago onward; cancelled bookings never appear. Unknown tokens/feed names return 404. Successful feeds use `Content-Type: text/calendar; charset=utf-8`; all calendar responses use `Cache-Control: no-store`. Tokens are secret: anyone with a link can read client names, phones, prices and locations in that feed. They are excluded from user payloads and calendar routes are excluded from request URL logging. Reset links if one is shared unintentionally.

Calendar names are “Sorted – Confirmed” and “Sorted – Enquiries”. Refresh hints request 15 minutes, but calendar providers control actual refresh timing. Events have stable booking UIDs, UTC dates, explicit end times or a one-hour default, and a booking link based on `APP_URL`.
Enquiry event descriptions include `Follow up: YYYY-MM-DD` when a follow-up date is set; the line is omitted otherwise.

## Payments
| Method | Path                     | Notes |
|--------|--------------------------|-------|
| GET    | /payments                | `?status=pending` = the "who owes me" view |
| POST   | /payments/:id/link       | creates Stripe Payment Link (503 if Stripe isn't configured), stores url, emits `payment.link_created` (n8n WhatsApps it) |
| POST   | /payments/:id/mark-paid  | manual: body `{method}` (cash/bank_transfer). Emits `payment.paid` |
| POST   | /bookings/:id/payments   | Record any instalment: `{ amount_cents: positive integer, method: "cash" | "bank_transfer" | "revolut", paid_on?: "YYYY-MM-DD" }`. Returns 201 `{ payment, booking }` in camelCase; payment kind is `custom`, status `paid`, VAT rate frozen. Emits `payment.paid`. |

Recording a payment requires a confirmed or completed booking (409 otherwise), owned by the caller (404 otherwise). The transaction locks the booking, rejects amounts above price minus paid payments (400 with the amount still owed), cancels all pending rows and deactivates their Stripe links after commit. A completed booking with money still owed gets one fresh pending balance row; confirmed bookings have no pending rows until completion. Fully paid bookings have none. Existing pending-row mark-paid remains available.

`paid_on` defaults to today in Europe/Dublin and cannot be in the future or an invalid calendar date (400). Today uses the current instant; past dates use noon Europe/Dublin, including daylight-saving time. Each custom payment can be selected for its own stable receipt through the existing document endpoint.

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
