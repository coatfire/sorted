# API contract

Base URL: `/api`. Auth: `Authorization: Bearer <jwt>` on everything except
`/auth/*` and `/webhooks/*`. Internal routes use `X-Internal-Secret`.

All money is integer cents. All timestamps ISO 8601 UTC. Request bodies are
snake_case and validated by the zod schemas in `packages/core/src/types.ts`;
responses are DB rows with camelCase keys (interfaces in the same file). This
doc lists routes and semantics; the schemas are the source of truth for fields.
Errors are `{ "error": "message" }` (or a zod `flatten()` object for 400s).

`GET /health` (no auth) → `{ ok, googleClientId, features: { automation, paymentLinks, googleSignIn, googleDrive, addressSearch } }` —
which integrations are configured, so the UI only offers what works.
`googleClientId` is the public OAuth client ID, or null. Drive needs only
`GOOGLE_CLIENT_ID`; Google sign-in still requires both ID and secret.

## Google Drive backup (optional)

Authenticated, tenant-scoped and disabled (404) without `GOOGLE_CLIENT_ID`:

- `GET /drive/files` returns `{ userId, logo, documents, photos, years }`.
  Documents are **already issued** invoices, receipts and quotes, assembled with
  the shared document renderer data, including each document's frozen logo
  (the top-level logo remains as a fallback for older clients). It never
  allocates numbers; previously issued quotes remain included after confirmation.
  Photos identify the user's expenses and receipt MIME types; photo bytes still
  use authenticated `GET /expenses/:id/receipt`. Years are all UTC years with a
  dated payment (including undone rows) or confirmed expense, so old CSVs can
  be refreshed to remove undone income through `GET /reports/export?year=…`.
- `POST /drive/backed-up` (no body) sets only the authenticated user's
  `driveBackedUpAt`, returning `{ driveBackedUpAt }`. The browser calls this only
  after every planned file is uploaded, updated or verified already present.
  The server does not attest to Google's uploads; the client orchestrates them.

Both endpoints send `Cache-Control: no-store`. No Google access or refresh token
is sent to Sorted's API, stored in the database or persisted by the app. The
browser requests only `drive.file`, with incremental scopes disabled, on an
explicit Settings button tap. The enabled Settings card lazy-loads Google
Identity Services and prepares its token client on mount; only a tap requests
a token and starts the backup.

Backups use an app-created `Sorted` folder marked for this Sorted user so two
Sorted accounts sharing a Google account cannot skip each other's numbered files.
Subfolders: `Invoices`, `Receipts`, `Quotes`, `Expense photos`. Existing document
and photo names are skipped, except voided receipts replace their previous PDF;
yearly `sorted-YYYY.csv` files are always updated in
place, including earlier years. Failed or cancelled runs never mark completion;
successful partial uploads remain available to skip on retry. An empty account
does not record a backup. Users manage/delete their backups in Google Drive.

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
| PATCH  | /auth/me            | business settings: `name`, `business_name`, `phone`, `review_link`, `address`, `iban`, `bic`, `revolut_link` |

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

`POST /bookings` accepts optional `status: "confirmed" | "enquiry"`.
Omission defaults to enquiry for older clients. Confirmed creation clears any
follow-up and creates a pending deposit payment when `deposit_cents > 0`, in
the same transaction as the client and booking(s). No money is marked paid.
After commit, confirmed creation emits `booking.confirmed` for each occurrence,
with the same payload as `/confirm`, through the shared booking-event helper.
Automation runs only when its webhook is configured. Enquiry creation emits
nothing. The web also offers a manual confirmation draft after saving.
All multi-table mutations keep the documented
users → clients → bookings → payments → invoices lock order.

### Quotes and repeat bookings

`POST /bookings/:id/documents` accepts `{ kind: "quote" }` alongside invoice
and receipt. A quote is an enquiry's PDF, not a separate entity. The booking
must belong to the user (404 otherwise) and still be an enquiry (409 otherwise,
including re-downloads). One number and issue time are allocated per booking;
the per-user quote sequence is independent of invoices/receipts and displayed
as QTE-0001. A new quote captures the booking's price at issue time. Like invoices,
its VAT rate is captured when first numbered. Validity is the Ireland-local
issue date plus 30 calendar days.

New invoices, receipts and quotes store a versioned `documentSnapshot` in the
same transaction as number allocation. It contains `vatRegistered` and all PDF
renderer data: business/client details, VAT number and breakdown (including a
registered 0% rate), line items, totals, payment history, bank/Revolut details,
logo, accent and footer. Reissues and Drive backups render this snapshot, not
current settings, booking prices or client details. Legacy rows with no snapshot
retain their existing live-render behaviour; no backfill is performed.
GDPR client anonymisation replaces the client section of retained snapshots
with `Deleted client` and no email/phone, in the same transaction as the live
records. Financial, VAT and business data remain unchanged.

### Revolut payment details

`PATCH /auth/me` accepts optional `revolut_link`: a username, `@username`,
`revolut.me/username`, or `https://revolut.me/username`. Usernames contain only
letters, digits, `.`, `_` and `-`. Stored values and camelCase `revolutLink`
responses use `https://revolut.me/username`. Empty/whitespace or null disables
the link; omission preserves it. Invalid input returns 400. Updates require
authentication and affect only the signed-in account.

Manual payment-request defaults support `{revolut_link}`. Custom payment
requests without it get `Pay by Revolut: <link>` appended unless that URL is
already present (with or without `https://`). Deposit confirmations with bank
details also include the link when money is due. No amount is embedded in the
URL. Opening drafts still records nothing; sent confirmation remains explicit.

`POST /bookings` optionally accepts `repeat: { every_weeks: 1 | 2 | 4,
count: 2..12 }`. Count is the total, including the first booking. All bookings
and an optional inline client are created in one transaction. Dates and optional
start times shift by calendar weeks in Europe/Dublin, not fixed UTC durations.
Optional end times preserve the original duration relative to each shifted start.
Every occurrence gets the chosen status. For enquiries, only the first gets
`follow_up_on` (including the normal two-day default); later bookings get null.
Confirmed repeats all have null follow-up and each gets its own pending deposit
payment if positive. The response is the first booking with `seriesCount`
(1 without repeat). Enquiry creation emits no automation events.
Invalid intervals/counts return 400 without creating anything.

During a skipped spring-clock hour, the time moves forward by the clock gap;
ambiguous autumn times preserve the original offset when possible.


Bookings include `followUpOn` (nullable YYYY-MM-DD) and `paymentRequestedAt`
(nullable UTC timestamp). Create/PATCH accept `follow_up_on`: a valid calendar
date, or null to remove the follow-up. Omitted on enquiry creation defaults to two days
after today in Europe/Dublin; omitted on PATCH preserves it. Only enquiries
may be assigned a follow-up date. Confirming or cancelling clears it.

`POST /bookings/:id/payment-link` creates/reuses a Stripe link for the booking's
full current price-minus-paid balance. Authenticated, tenant-scoped, confirmed/
completed bookings only. Returns the pending payment row (including `linkUrl`).
Under the global transaction lock order, reuse a sole pending row with the exact
balance; otherwise void pending rows and insert one pending custom payment for
the balance. Deactivate voided links after commit. Missing/foreign bookings
return 404; cancelled/enquiry/settled bookings return 409; unconfigured Stripe
returns 503 without creating rows. Stripe failures return 502; retries reuse the
pending row. The existing per-payment link endpoint remains available.
Money's booking-level Mark paid uses `POST /bookings/:id/payments` with the full
owed amount, never marks both a pending row and a new record paid.

### Saved services

`PATCH /auth/me` is partial: omitted fields are preserved; supported nullable
fields can be cleared with null. Settings autosave sends only edited fields,
serially. Welcome sends `business_name`, optional/null `name`, and `services`;
only a missing business name requires the welcome step. Payment details can be
saved later with just `iban`, `bic` and/or `revolut_link`. No new endpoint or
migration is needed for incremental setup.

`PATCH /auth/me` accepts optional `services: [{ name, price_cents }]`, up to
30 entries. Names are trimmed, nonempty, at most 200 characters, and unique
case-insensitively. Prices are nonnegative integer cents, at most 2147483647.
Invalid lists return 400. Omission preserves the catalogue; `[]` clears it.
User responses and the `users.services` JSONB column contain camelCase
`[{ name, priceCents }]`, defaulting to `[]`. Updates are authenticated and
tenant-scoped. These are suggestions: bookings retain their own service text
and price, unaffected by later catalogue changes.

Client creation (including inline booking clients) and PATCH normalise mobile
numbers to digits-only international form: `08…` → `3538…`, `+353`/`00353` →
`353…`, formatting removed; other `+` international numbers retain their country
code. Invalid numbers return 400. Existing stored numbers remain readable.

`POST /bookings/:id/message-sent` accepts `{ kind, channel, acknowledgement_id }`.
Kinds: `confirmation`, `payment_request`, `follow_up`; channels: `whatsapp`,
`email`; acknowledgement ID: UUID, stable across retries of the same draft.
Authenticated and tenant-scoped. Records a message-log entry with
`meta: { userConfirmed: true, kind, acknowledgementId }`; this is the user's
acknowledgement, never verified delivery. Follow-ups use the existing reminder
template type. Payment requests update `paymentRequestedAt`; follow-ups set
`followUpOn` to today +3 calendar days in Europe/Dublin and leave status enquiry.
Confirmations change neither follow-ups nor payment reminders. No income,
receipt or automatic message is created. Booking lock and history write are
transactional, with global lock order/deadlock retry; duplicate acknowledgement
IDs return without recording/rescheduling again. Missing/foreign bookings: 404;
follow-up on a non-enquiry: 409; invalid input: 400. Confirm/cancel clears
enquiry follow-ups without changing payment reminders.

`GET /bookings/documents` lists every invoice, receipt and quote the trader has
issued, newest first: `{ id, bookingId, kind, number, issuedAt, paymentId,
voidedAt, sentAt }`. Snapshots are not included; `sentAt` is the latest
acknowledged `document` message for that document, or `null`.

`message-sent` also accepts `kind: "document"` with a required `document_id`
(an unvoided document on that booking, else 404), optional `review_included`,
and the extra channel `share` (the phone's share sheet). It logs template
`document` with `meta.documentId`, `meta.documentNumber` and
`meta.reviewIncluded`; when `review_included` is true it also sets the booking's
`reviewRequestedAt`. `document_id`, `review_included` and `share` are rejected
on other kinds.

Legacy `POST /bookings/:id/payment-requested` (authenticated, no body) records the
current time in `paymentRequestedAt` and returns the booking. Missing or foreign
bookings return 404. It emits no event and creates no message-log entry: opening
a draft is not proof the user sent it. Manual draft sheets now call
`message-sent` only after **I sent it**. Opening WhatsApp/Email, an unsuccessful
app launch, or choosing **Close** records nothing.

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

## Address search (optional)

Off unless `GOOGLE_MAPS_API_KEY` is set; `features.addressSearch` tells the UI whether to offer it.
The key stays on the API and is never sent to a browser.

| Method | Path | Notes |
|--------|------|-------|
| POST | /places/search | Authenticated. Body `{ input }`, 3–200 characters after trimming. Returns `{ source: "google", suggestions: [{ text, main, secondary }] }`, at most 5, from Google's Places API (New) Autocomplete restricted to the island of Ireland. `text` is what goes into a booking's `location`. |

Errors: 400 input too short or malformed, 429 after 40 searches by one user in a minute, 502 Google
unreachable or unreadable, 503 no key configured. It is a POST with `Cache-Control: no-store` so that
what is typed, often a client's home address, never appears in a URL or request log; failures log
Google's status only. Nothing is stored. Results must be shown with the "Google Maps" attribution.
The per-user limit is held in memory per instance: it stops a runaway client, and the spending
cap belongs on the key's quota in Google Cloud.

## Payments
### Correcting a manually recorded payment

`PATCH /payments/:id` accepts `{ amount_cents, method, paid_at }`: a positive
integer amount, cash/bank_transfer/revolut, and an ISO timestamp with timezone
no later than now. At least one field is required; omissions stay unchanged. Only paid manual rows may be
edited. Total paid cannot exceed the booking price (409). An issued receipt
blocks editing (409): **A receipt was issued for this payment. Undo it and record it again.**

`POST /payments/:id/undo` retains the row, amount, method and paid date for audit,
sets its existing status to `cancelled`, and marks any linked receipt with
nullable `invoices.voided_at` (migration 0017). It never moves money or changes
the booking status. Frozen document and receipt snapshots are unchanged; PDF
assembly overlays **VOID**. Re-requesting that existing receipt returns it,
including its void marker, but cannot issue a new receipt for an undone row.

Both reject Stripe-paid rows with 409 **Paid by card — refund it in Stripe**.
`method=stripe` is the paid-by-card marker; an old Stripe link ID on a manually
settled payment is not. Unknown or other-tenant rows return 404; non-paid rows
return 409. These operations use the shared deadlock-retrying transaction and
users → clients → bookings → payments → invoices row-lock order. Mismatched
pending balances are cancelled and their links deactivated after commit.
Events are `payment.corrected` and `payment.undone`, emitted after commit.

Undone rows are excluded, not negated, in income, tax and accountant CSVs.
Client deletion keeps their audit rows through the existing anonymisation path,
even when every previously paid row has since been undone.
Drive refreshes CSVs even for a year whose last paid row was undone, and
replaces previously backed-up receipt PDFs with their void-marked versions.
The backup plan also refreshes every yearly CSV already present in this user's
Sorted Drive folder, even when date corrections or deletions leave that year
empty. Empty years overwrite the old CSV with a header-only export.
`GET /payments` includes `receiptVoidedAt` beside each payment for the UI.

| Method | Path                     | Notes |
|--------|--------------------------|-------|
| GET    | /payments                | `?status=pending` = the "who owes me" view |
| POST   | /payments/:id/link       | creates Stripe Payment Link (503 if Stripe isn't configured), stores url, emits `payment.link_created` (n8n WhatsApps it) |
| POST   | /payments/:id/mark-paid  | manual: body `{method}` (cash/bank_transfer/revolut). Emits `payment.paid` |
| POST   | /bookings/:id/payments   | Record any instalment: `{ amount_cents: positive integer, method: "cash" | "bank_transfer" | "revolut", paid_on?: "YYYY-MM-DD" }`. Returns 201 `{ payment, booking }` in camelCase; payment kind is `custom`, status `paid`, VAT rate frozen. Emits `payment.paid`. |

Recording a payment requires a confirmed or completed booking (409 otherwise), owned by the caller (404 otherwise). The transaction locks the booking, rejects amounts above price minus paid payments (400 with the amount still owed), cancels all pending rows and deactivates their Stripe links after commit. A completed booking with money still owed gets one fresh pending balance row; confirmed bookings have no pending rows until completion. Fully paid bookings have none. Existing pending-row mark-paid remains available.

`paid_on` defaults to today in Europe/Dublin and cannot be in the future or an invalid calendar date (400). Today uses the current instant; past dates use noon Europe/Dublin, including daylight-saving time. Each custom payment can be selected for its own stable receipt through the existing document endpoint.

## Expenses
| Method | Path                    | Notes |
|--------|-------------------------|-------|
| POST   | /expenses/receipts      | body `{content_type, data_base64}`: a JPEG/PNG/WebP photo (downscaled by the client, ≤1.5 MB) or a PDF (≤3 MB) → `{receipt_key}`. Stored in Postgres for now |
| GET    | /expenses/:id/receipt   | the receipt photo or PDF |
| POST   | /expenses               | optional `receipt_key`. `confirmed: true` + all four fields → a confirmed expense; otherwise `status=needs_review` (where OCR suggestions will land) |
| GET    | /expenses               | `?year=&category=&status=` |
| PATCH  | /expenses/:id           | confirm/correct OCR fields → `status=confirmed` |
| DELETE | /expenses/:id           | also deletes its receipt |

## Reports
| Method | Path                  | Notes |
|--------|-----------------------|-------|
| GET    | /reports/summary      | `?year=` → income, expenses, profit, by month + category (dashboard) |
| GET    | /reports/export       | `?from=YYYY-MM-DD&to=YYYY-MM-DD` (both days included, dates in Ireland) or `?year=` → accountant CSV: income lines then expense lines, oldest first. `400` if a date is missing or invalid, or `from` is after `to`. The file is named `sorted-2025.csv` for a whole calendar year, otherwise `sorted-<from>-to-<to>.csv`. UTF-8 with a byte order mark so Excel and Sheets read accented names correctly; a text cell starting with `=`, `+`, `-` or `@` is prefixed with `'` so it can't run as a formula |

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

## Incomplete enquiries (migration 0018)

Enquiries may omit `start_at` and/or `price_cents` (stored as null).
`time_tbc` defaults to false. With a known date but unknown time, send
`time_tbc: true`; the API stores Ireland-local midnight for that date.
Clearing `time_tbc` requires `start_at` in the same request; omitting it returns
422, `Add a time`. Explicit null clears the date and time on an enquiry.
Confirmation still requires an agreed date and time, so cannot accept null.
This is an all-day placeholder, not an agreed appointment time.
An unknown price requires a zero deposit. Repeats require a date.

Only confirmed/completed bookings require a date, an agreed time and a price.
Create rejects incomplete confirmed bookings with 400; updates/status changes
reject incomplete confirmed/completed bookings with 422. Confirmation lists missing items.
An incomplete enquiry can be cancelled as-is: missing details remain unchanged,
its follow-up is cleared, and payment reminders are left untouched. The
`booking.cancelled` event may contain null `start_at` and `price_cents`.
`POST /bookings/:id/confirm` optionally accepts `start_at`, `time_tbc` and
`price_cents` to fill details and confirm atomically under the booking lock.
All mutations remain tenant-scoped. Explicit null clears enquiry details;
omitted PATCH fields preserve their values.

Recording/requesting payment or issuing a quote/invoice without a price
returns 409, `Add a price first`. No payment row is created for an enquiry.
This guard only applies to issuing new documents: already-issued frozen
quotes, invoices and receipts remain retrievable even if the price is now null.
Undated enquiries are excluded from calendar feeds; time-TBC enquiries are
all-day events with exclusive next-day ends. Unknown prices never contribute
to owed, tax or CSV totals; Drive/CSV income continues to derive from paid rows.
Migration 0018 is append-only and must be applied separately before deployment.
