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
thinks: *who, what, when, how much.* Most bookings are already agreed
appointments: the primary save creates confirmed bookings, not enquiries.

**Book again:** confirmed, completed and cancelled booking details offer a
44px-minimum **Book again** button. It opens the same new-booking form with the
client, service, price, deposit, location and notes copied; the original is not
changed. Default to the original weekday and Ireland-local time, at least one
week after the later of the original date or today. **1 week / 2 weeks / 4 weeks
/ 6 weeks** chips change the new date, retaining weekday and time.
The primary **Save booking** also defaults to confirmed when booking again.

New bookings have a collapsed **Repeat this booking** extra. Opening it shows
**Repeat**: **Doesn’t repeat** (default), **Every week**,
**Every 2 weeks**, **Every 4 weeks**. Repeating shows **How many times**, 2–12,
with the explanation that this includes the first booking. Validate on blur.
Every occurrence uses the chosen save status, with the same Ireland-local
time across clock changes. Confirmed repeats each get their own pending deposit
if positive, with no follow-up. Enquiry repeats have a follow-up only on the first.

There is no **Follow up on** field in Add/Edit Booking. Saving as enquiry
defaults to two days after today in Ireland. Change/remove it through Today's
**Later** sheet or enquiry detail's **Change follow-up** action. Editing other
booking details preserves it. Confirm/cancel clears the date.
Enquiry calendar descriptions include “Follow up: YYYY-MM-DD” when set.

1. **Client** — required name, searching loaded clients locally as you type
   (up to four matches). Choose an existing client or enter a new name with
   optional mobile and email directly; the new client is created on save.
   A selected client becomes a summary with **Change**. Mobile helper text:
   "For WhatsApp drafts you send yourself."
2. **Service** — required free text with up to six priced suggestion chips:
   saved services first, then recent booking services, deduplicated by name
   case-insensitively. Recent services use their newest booking price. Chips
   fill name and price if empty or still chip-filled; never replace a manually
   typed price (or Book again's prefilled price). Clearing price allows filling again.
3. **Date & time** — native pickers (`<input type="date/time">`). Fastest
   and most familiar; do not build a custom calendar.
4. **Price** — numeric keypad (`inputmode="decimal"`), € prefix, converts to
   cents on submit.
5. **Deposit** — collapsed behind "＋ Add deposit"; most bookings skip it.
6. **Location / Notes** — collapsed behind **Location or notes**.
7. **Repeat** — collapsed behind **Repeat this booking**.

Sticky bottom buttons: primary **Save booking** creates confirmed appointments;
quiet **Save as enquiry** keeps the two-day follow-up default. Enter submits the
primary choice. Both are disabled during saving and after a committed save whose
reload failed; show the saved-error message with **Reload**, never resubmit.

After save, a short success state replaces the old confirmation decision:
- Confirmed: **Booked** (or **N bookings added**), booking summary,
  **Send confirmation** and **Done**. Send confirmation opens the existing
  WhatsApp/email draft sheet for the first booking only. Explicitly say it opens
  a draft for the user to review and send; do not claim nothing has been sent,
  since configured automation may already have sent a confirmation.
- Enquiry: **Saved as enquiry**, "We'll remind you on <date>", summary and
  **Done**. For repeats, explain only the first has the reminder.
- Done opens the first booking's detail. Confirmed creation emits the same
  post-commit automation event as confirming an enquiry, for every occurrence.
  Enquiry creation emits none. Creation never records a deposit as paid.

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
  This is the only record/mark-paid action on booking detail; Money keeps its
  quick Mark paid sheet with Cash / Bank transfer / Revolut. Failed saves stay
  open with an inline error. If saving succeeds but reloading fails, explain
  that it was saved, keep the sheet open, and offer Reload instead of letting
  the person record the same payment again.
- **Request payment:** the manual-draft Sheet has an editable **Amount to
  request**, initially the balance, from €0.01 to the balance. The draft's
  balance placeholder uses this amount. Include a pending payment link only
  when its amount matches the requested amount; disable draft actions for
  invalid amounts. Manual drafts are never logged as sent.
- **Quote:** enquiries have a primary **Quote** action using the same PDF
  share/download flow and branding as invoices. Title **Quote**, stable
  **QTE-0001** number and issue date, **Valid until** (issue date + 30 days),
  service/date/price at issue time and VAT breakdown, deposit if positive, and
  **To go ahead, just reply to confirm.** No paid/balance or bank-detail section.
  Newly issued PDFs freeze their visible content, including branding, client
  details, prices, payment details and VAT. Reopening a new document does not
  change it; legacy documents without a snapshot retain live rendering.
  It is a quote, not proof of acceptance or payment. Confirming remains the
  existing Confirm action, and removes Quote availability.
- **Messages (M3):** timeline of message_log rows — "✓ Confirmation sent
  Tue 14:02 · ✓ Reminder sent Fri 10:00". Failed sends show `--danger` with
  the reason. This card is what makes the automation trustworthy — the
  vendor can *see* what their client was sent.
  In demo, label the timeline **Sample activity — nothing was sent**.
- Cancel = confirm dialog stating consequences plainly: "Removes it from
  your calendar. Pending payment links will be cancelled."

### 4. Money — `/money` (M2, M6)
Two stacked zones:

Outstanding cards have a primary **Send reminder** button opening the existing
payment-request Sheet with that payment's amount, still editable up to the
unpaid balance. Show **Not asked yet**, **Asked today**, or **Asked n days ago**
using Ireland-local days and the booking's most recent user-confirmed request timestamp.
WhatsApp/Email taps record nothing. After opening a draft, ask **Did you send
it?** with **Yes, I sent it** (records the time) and **Not yet** (records nothing).
Keep the explanation that the user reviews and sends in their own app; never
show “Sent” for a manual draft. Keep existing payment-recording actions.

- **Owed to you** (M2): hero number = total outstanding (amber), then rows:
  client · service · amount · job date (e.g. **Deposit · job on Wed 18 Nov**
  or **Balance · job was 2 days ago**, using Ireland-local days), each with
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
**Your services** lets traders add, edit or remove up to 30 name/price pairs.
Show names, euro prices and a compact remove icon on one row. Remove icons
have a minimum 44px tap target and an accessible "Remove <name>" label. Show
**Add service**. Names must be unique case-insensitively; prices are integer
cents after parsing. Show inline validation. Empty lists are allowed. Changes
use **Save settings**, not immediate auto-save; catalogue edits never change
existing bookings or issued documents.

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

## Payment details and issued documents (Settings)

### Revolut payment details and documents

- Settings has **Revolut.me link** beside bank details. Accept a username,
  `@username` or full Revolut.me link and save its canonical HTTPS URL. Allow
  letters, digits, dots, underscores and hyphens; show a field error otherwise.
  Blank turns the link off. Demo supports the same settings and document flow.
- Payment drafts include **Pay by Revolut: <link>** via `{revolut_link}` or
  one automatic append for older customised payment templates. Do not append
  another copy when that URL is already present. Confirmations with bank
  details and a deposit due include it too. No undocumented amount suffix.
- Invoices and quotes include a clickable **Pay by Revolut** line. Receipts
  do not ask for another payment. Record payment defaults to Revolut when a
  link is set; Cash and Bank transfer remain available. Money's immediate
  Mark paid choices stay explicit rather than selecting or saving for the user.
- New issued documents preserve their branding, business/client details,
  financial data and payment links. VAT-registered documents, including 0%,
  keep their VAT breakdown and VAT number after deregistration. Settings edits
  affect future documents, not issued ones. Legacy unsnapshotted documents
  keep existing behaviour.

## Google Drive backup (Settings)

- Show a **Back up to Google Drive** card with one button only for signed-in
  users when `features.googleDrive` is true. Hidden in demo and when disabled.
- Explain that issued invoices, receipts, quotes, expense photos and yearly CSVs
  go into a Sorted folder in their Google Drive. It runs only when tapped,
  never automatically. Google consent requests access only to app-created files.
- Preload Google Identity Services and the lazy backup module when the enabled,
  signed-in card mounts. Prepare the token client before enabling the button;
  show **Getting ready…** while loading. Request the token synchronously on tap
  to preserve the browser's user gesture. Do not open a popup or run a backup on
  mount, and load nothing in demo or when disabled. Preparation failure offers
  **Try again** with the normal failure wording.
  Keep the button disabled during a run, and announce **Backing up 12 of 40…**.
- Show **Last backed up: today** / **Last backed up: N days ago** only after a
  completed backup (remembered across visits). Success: **Backup finished**.
- On popup closure, denied consent, network or upload failure:
  **Backup didn't finish. Nothing was lost — try again.** Keep the previous
  timestamp unchanged. Empty account: **No files to back up yet.**
- Keep existing PDF/photo copies; refresh all yearly CSVs in place on every run.
  Retrying a partial backup skips files already uploaded. Button target ≥44px.

## Accessibility & PWA floor (M8 checklist)

Visible focus rings · chips never rely on colour alone (label text always
present) · 44px targets · `prefers-reduced-motion` respected · Lighthouse
PWA installable pass · offline: cached shell + "You're offline, showing
last-loaded data" banner (read-only offline is enough for MVP).
