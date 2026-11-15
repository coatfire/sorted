# UI spec

The product's entire promise is speed and calm. Every screen decision below
serves one of two rules:

1. **The 30-second rule.** Logging a booking with a brand-new client takes
   under 30 seconds, one-handed, on a phone, possibly while standing in a
   salon. Count taps on every design decision.
2. **The glance rule.** The three questions a vendor actually has — *what's on
   today, who owes me, how's my year going* — are each answered without any
   navigation beyond one tab tap.

Audience note: wedding vendors are visual, brand-conscious people (their own
Instagram grids are curated). The app should feel like a well-made notebook,
not accounting software. Warm, quiet, zero jargon: "Money", never "Accounts
receivable"; "Owed to you", never "Outstanding invoices".

---

## Authentication

### Optional Google sign-in

Login and Signup show **Continue with Google** above the email/password form
only when `/api/health` reports `features.googleSignIn: true`. Use a white
48px-minimum button, the standard coloured Google G on white, neutral border
and dark label. The entire button is one tap target and performs a full-page
navigation to the API start route. Never show it in demo mode or when disabled;
email/password remains available without the integration.

`/login/google` shows **Signing you in…**, removes the exchange code from browser
history and swaps it once for a session through the backend. Existing profiles
go to Today; new/incomplete profiles go to the same profile step as email signup.
Failures return to Login with **Couldn't sign in with Google. Try again or use
your email.** No Google SDK, account picker or provider tokens run in the app.

## Design tokens


Already seeded in `apps/web/src/styles.css`; this is the fuller system to
grow into (M8 polish, but use these values from M1 so there's no repaint).

**Color**
| Token     | Value     | Use |
|-----------|-----------|-----|
| `--bg`    | `#FAFAF7` | App background — warm paper, not clinical white |
| `--ink`   | `#1C1C1A` | Primary text |
| `--muted` | `#6B6B66` | Secondary text, labels |
| `--line`  | `#E6E6E0` | Hairline dividers, card borders |
| `--brand` | `#14532D` | Deep bottle green: primary buttons, active tab, FAB |
| `--paid`  | `#15803D` | Paid chips only (lighter green so it's not the brand everywhere) |
| `--due`   | `#B45309` | Amber: pending/owed. **Never red** — owed money is normal, not an alarm |
| `--danger`| `#B91C1C` | Destructive actions + failed messages only |

Status chip mapping: `enquiry` = muted outline · `confirmed` = brand ·
`completed` = paid green · `cancelled` = muted strikethrough ·
payment `pending` = amber · `paid` = green.

**Type**
- System stack for MVP (`system-ui`) — fast, native-feeling in a PWA.
- M8 option: a single display face for screen titles and the big money
  numbers (something with warmth — e.g. a humanist serif) while body stays
  system. One face maximum; this is a tool, not a brochure.
- Scale: screen title 1.4rem/600 · money-hero 2rem/700 tabular-nums ·
  body 1rem · labels/chips 0.8rem. **All money figures use
  `font-variant-numeric: tabular-nums`.**

**Spacing & shape**
- 4px base grid. Cards: 12px radius, 1px `--line` border, no shadows except
  the FAB. Screen padding 16px. Content max-width 560px (already in CSS).
- Touch targets ≥ 44px. Primary buttons full-width, 52px tall.

**Motion**
- Almost none. One signature moment: when a payment flips to paid, the amber
  chip cross-fades to green with a ~200ms ease — that's the dopamine hit of
  the whole product. Respect `prefers-reduced-motion`.

---

## Navigation model

Bottom tab bar (already built in `AppShell.tsx`):

```
[ Today ]   [  ＋  ]   [ Money ]   [ Expenses ]
```

- The centre **＋ FAB goes straight to Add Booking** — no menu in between.
- Long-press ＋ (M5, nice-to-have): quick action sheet → "Booking / Receipt".
- Client list is deliberately NOT a tab: clients are reached through bookings
  or via search on Today. A fifth "Clients" tab makes it feel like a CRM.
- Settings: small avatar/gear top-right of Today → Settings screen.

Route map:
```
/                  Today (home)
/bookings/new      Add booking
/bookings/:id      Booking detail
/clients/:id       Client detail
/money             Money (owed + year summary)
/expenses          Expenses (snap + list)
/expenses/:id      Expense confirm/edit
/settings          Settings + onboarding fields
/login             Magic link
```

---

## Screens

### 1. Today — `/` (M1)
The morning-coffee screen.

- **Follow up** is the first section after the header, above the snapshot.
  Show enquiries due today or earlier, oldest follow-up first; hide the section
  when empty. Each card links to the booking and shows client, service and
  **Due today** / **X days overdue**. Separate 44px-minimum **Message** and
  **Later** buttons must not be nested inside the booking link.
- Message opens an editable draft: “Hi {first name}, just following up on your
  enquiry about {service} on {date}. Would you like me to book you in?” followed
  by the business name. WhatsApp and Email open the trader's app; missing contact
  details disable that action with a reason. Nothing is labelled or logged “Sent”.
- Later opens a Sheet with **Tomorrow**, **In 3 days**, **Next week**, a date
  picker with **Save date**, and **Remove follow-up**. Dates use Europe/Dublin.
  A quick choice saves immediately and closes the Sheet.

```
Sorted                                (gear)
┌────────────────────────────────────────┐
│ TODAY · Tue 14 Jul                     │
│ 10:00  Sarah K · Bridal trial   €80  ● │   ← chip = status
│ 14:30  O'Brien wedding · Hair  €350  ● │
├────────────────────────────────────────┤
│ UPCOMING                               │
│ Thu 16  Emma L · Makeup        €120  ● │
│ Sat 18  Ryan/Walsh wedding     €400  ● │
└────────────────────────────────────────┘
```

- Grouped by day, 14-day window, then "Later" collapsed.
- Row = time · client · service · price · status chip. Whole row taps to
  detail. No swipe actions in MVP (discoverability is poor; buttons live on
  detail).
- Pull-to-refresh.
- **Empty state:** friendly, directive: "No bookings yet. Tap ＋ to log your
  first — it takes 30 seconds." Empty states are onboarding; write them all.

### 2. Add Booking — `/bookings/new` (M1) — THE screen
One scrollable form. No steps, no wizard. Field order matches how a vendor
thinks: *who, what, when, how much.*

**Book again:** confirmed, completed and cancelled booking details offer a
44px-minimum **Book again** button. It opens the same new-booking form with the
client, service, price, deposit, location and notes copied; the original is not
changed. Default to the original weekday and Ireland-local time, at least one
week after the later of the original date or today. **1 week / 2 weeks / 4 weeks
/ 6 weeks** chips change the new date, retaining weekday and time.

New bookings have **Repeat**: **Doesn’t repeat** (default), **Every week**,
**Every 2 weeks**, **Every 4 weeks**. Repeating shows **How many times**, 2–12,
with the explanation that this includes the first booking. Validate on blur.
Every occurrence is an enquiry, with the same Ireland-local time across clock
changes. Only the first has a follow-up date. Save shows **N bookings added**;
the success screen explains that each enquiry is confirmed separately.

Enquiry forms show **Follow up on**, defaulting to two days after today in
Ireland. It is optional; blank removes it. Validate dates on blur. Enquiry
detail displays the date (or **No follow-up set**) and **Change follow-up**,
opening the same date Sheet. Confirm/cancel clears the date.
Enquiry calendar descriptions include “Follow up: YYYY-MM-DD” when set.

1. **Client** — search-as-you-type against `GET /clients?q=`. First result row
   is always "＋ New: '<typed text>'" which expands inline: Name (pre-filled
   with what they typed) + Mobile. Mobile is optional but nudged:
   helper text "Add a mobile so Sorted can send confirmations for you."
2. **Service** — plain text with recent-services suggestions (local, from
   last 10 bookings — no API needed).
3. **Date & time** — native pickers (`<input type="date/time">`). Fastest
   and most familiar; do not build a custom calendar.
4. **Price** — numeric keypad (`inputmode="decimal"`), € prefix, converts to
   cents on submit.
5. **Deposit** — collapsed behind "＋ Add deposit"; most bookings skip it.
6. **Location / Notes** — collapsed behind "＋ More".

Sticky bottom button: **Save booking**.

After save → interstitial, not a redirect:
> **Booking saved.**
> [ Confirm & notify Sarah ]  ← primary; fires POST /confirm (WhatsApp + cal)
> [ Keep as enquiry ]         ← quiet secondary
> If client has no phone, primary reads "Confirm booking" and a caption says
> "No mobile on file — no message will be sent."

This makes the automation moment explicit and consented, every time. No
surprise messages to clients = trust.

### 3. Booking detail — `/bookings/:id` (M1–M3)
Stacked sections:
- **Header:** service, client name (→ client detail), date/time, location,
  status chip.
- **Actions (contextual to status):**
  - enquiry → `Confirm & notify` / `Edit` / `Cancel`
  - confirmed → `Mark complete` (primary) / `Edit` / `Cancel`
  - completed → payment actions only
- **Money card:** price, deposit, list of payment rows each with amount ·
  kind · chip, and per-pending-row buttons `[Send payment link] [Mark paid]`.
  "Mark paid" opens a sheet: Cash / Bank transfer. Header line: "€120 of
  €350 paid".
- **Add to calendar:** non-cancelled bookings offer a button opening a Sheet
  with **iPhone / phone calendar** (share an `.ics` file where supported,
  otherwise download) and **Google Calendar** (a prefilled event). Explain
  that this is a one-off copy; automatic updates come from Settings. Works
  in demo too. Booking location opens Google Maps directions in a new tab.
- **Calendar subscriptions (Settings):** replace the Google Calendar “soon”
  connection with **Add bookings to your calendar**. Confirmed and Enquiries
  each have 44px-minimum **iPhone / Mac** and **Google** links. Explain:
  “Pick a colour for each calendar in your calendar app. Changes can take a
  few hours to show in Google.” **Reset links** requires confirmation:
  “Old links will stop working.” In demo, disable the controls and show
  “Available when you sign in”; never show fake subscription URLs.
- **Record payment:** confirmed/completed bookings with money owed offer a
  44px-minimum button opening a Sheet with a euro-prefixed decimal amount
  (defaults to all outstanding), method (Cash / Bank transfer / Revolut), and
  date (defaults to today in Ireland; no future dates). Validate on blur,
  clear errors on edit, focus the first invalid field on submit. Success:
  "Payment recorded". Custom rows are labelled "Payment" and each can have
  its own Receipt. At paid ≥ price show **Paid in full** and hide the button.
- **Request payment:** the manual-draft Sheet has an editable **Amount to
  request**, initially the balance, from €0.01 to the balance. The draft's
  balance placeholder uses this amount. Include a pending payment link only
  when its amount matches the requested amount; disable draft actions for
  invalid amounts. Manual drafts are never logged as sent.
- **Quote:** enquiries have a primary **Quote** action using the same PDF
  share/download flow and branding as invoices. Title **Quote**, stable
  **QTE-0001** number and issue date, **Valid until** (issue date + 30 days),
  current service/date/price and VAT breakdown, deposit if positive, and
  **To go ahead, just reply to confirm.** No paid/balance or bank-detail section.
  It is a quote, not proof of acceptance or payment. Confirming remains the
  existing Confirm action, and removes Quote availability.
- **Messages (M3):** timeline of message_log rows — "✓ Confirmation sent
  Tue 14:02 · ✓ Reminder sent Fri 10:00". Failed sends show `--danger` with
  the reason. This card is what makes the automation trustworthy — the
  vendor can *see* what their client was sent.
- Cancel = confirm dialog stating consequences plainly: "Removes it from
  your calendar. Pending payment links will be cancelled."

### 4. Money — `/money` (M2, M6)
Two stacked zones:

Outstanding cards have a primary **Send reminder** button opening the existing
payment-request Sheet with that payment's amount, still editable up to the
unpaid balance. Show **Not asked yet**, **Asked today**, or **Asked n days ago**
using Ireland-local days and the booking's most recent draft-opening timestamp.
WhatsApp/Email taps in any payment-request Sheet record that time, not delivery.
Keep the explanation that the user reviews and sends in their own app; never
show “Sent” for a manual draft. Keep existing payment-recording actions.

- **Owed to you** (M2): hero number = total outstanding (amber), then rows:
  client · service · amount · days-since-completed, each with
  `[Send link] [Mark paid]`. Sorted oldest first — that's the chase order.
  Empty state: "Nobody owes you anything. Lovely." (green tick).
- **This year** (M6): income / expenses / **profit** as three figures,
  a simple 12-bar month strip (CSS bars are fine — no chart library), and a
  full-width **Export for accountant** button → downloads the CSV. This
  button is the retention feature; give it visual weight year-round, not
  just in January.

### 5. Expenses — `/expenses` (M5)
- Top: full-width **📷 Snap receipt** button (opens
  `<input type="file" accept="image/*" capture="environment">`).
- Upload → goes straight to **Confirm screen** (`/expenses/:id`): receipt
  photo on top (tap to zoom), four fields below pre-filled by OCR —
  Merchant, Amount, Date, Category (horizontal chip row, not a dropdown) —
  then **Confirm expense**. Fields the OCR was unsure about (null) get focus
  first. Target: confirm a clean receipt in 2 taps.
- Below the snap button: this year's list grouped by month, category chip +
  amount per row, small year-total in the header.
- **Never auto-confirm OCR** — the confirm tap is what makes it a tax record.

### 6. Settings — `/settings` (M3/M7/M8)
Business name · your mobile · Google review link (M7) · calendar
subscriptions (Confirmed / Enquiries) · currency (locked EUR for now,
visible) · logout.
First-run onboarding = this same screen presented as 3 quick cards after
first login, skippable.

### 7. Login — `/login` (M1)
Email field → "Send me a login link" → check-your-email state. Token in URL
(`?token=`) auto-verifies and redirects to Today. No passwords anywhere, and
say so: "No password. We email you a link."

---

## Component inventory (build once, in M1)

`<StatusChip>` · `<MoneyText>` (tabular-nums, euros()) · `<Card>` ·
`<ListRow>` (leading/primary/secondary/trailing slots) · `<PrimaryButton>` /
`<QuietButton>` · `<Sheet>` (bottom action sheet) · `<EmptyState>`
(icon + line + action) · `<Field>` (label + input + helper). That's the whole
kit; resist adding more.

## States & copy rules

- Every list screen ships with a designed **empty state** — they're the
  onboarding.
- Loading: skeleton rows, never spinners on full screens.
- Errors name the fix: "Couldn't send the link — Sarah has no mobile number.
  Add one on her client page." Never "Something went wrong."
- Buttons say what happens: "Confirm & notify Sarah", "Send payment link",
  "Export for accountant". An action keeps its name through the flow
  (button "Mark paid" → toast "Marked paid").
- Dates are human: "Tomorrow 10:00", "Thu 16 Jul". Money always €, always
  2dp, always tabular.

## Accessibility & PWA floor (M8 checklist)

Visible focus rings · chips never rely on colour alone (label text always
present) · 44px targets · `prefers-reduced-motion` respected · Lighthouse
PWA installable pass · offline: cached shell + "You're offline, showing
last-loaded data" banner (read-only offline is enough for MVP).
