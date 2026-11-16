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
Only a missing business name makes a profile incomplete; personal name is optional.
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
The morning-coffee screen: where do I need to be next, then what needs attention.
No weekly totals, charts or snapshot card.

- **Header:** Sorted, an Ireland-local time-of-day greeting and Settings gear.
- **Next appointment:** the earliest confirmed booking that has not ended.
  Use `endAt`, or one hour after start when absent; include appointments already
  in progress and label them **Now**. Otherwise show **In 2 hours**,
  **Tomorrow, 10:00**, or **Wed 18 Nov, 14:00**, using Ireland-local dates/times.
  Show client, service, remaining deposit/payment phrase derived from
  `bookingStage`, and location with Google Maps directions when present.
  The main hero links to booking detail; directions are a separate 44px target,
  never a nested link. Empty: **No appointments ahead** with a + booking hint.
- **Needs attention:** one compact card of small rows, hidden entirely when empty:
  - Follow up: enquiries due today or earlier, oldest follow-up first, with client,
    service and **Due today / X days overdue**. Separate **Message** and
    **Remind me later** actions, each at least 44px, outside the booking link.
  - To wrap up: past-date open bookings. Confirmed jobs offer **Mark complete**;
    enquiries offer **Review enquiry** rather than being silently confirmed.
    Save errors stay visible; a committed refresh error offers Reload.
  - **€X owed by N clients** links to Money; count distinct clients, not payments.
    Up to three compact booking rows link to detail, oldest job first.
    Both pages use core `moneyOwed`: only due/owing bookings, price minus paid;
    future jobs, enquiries and cancelled bookings never inflate owed-now totals.
- Follow-up Message is an editable draft with WhatsApp/Email, retaining missing
  contact reasons. **Close** dismisses without changing anything. After opening
  an external app, **I sent it** records user-confirmed sending (not delivery)
  and sets the next follow-up to today +3 calendar days in Europe/Dublin. The
  enquiry remains until confirmed/cancelled and returns after three days.
  A failed external-app attempt records nothing without that acknowledgement.
  Confirming/cancelling clears only the enquiry follow-up, not payment reminders.
  **Remind me later** opens
  Tomorrow / In 3 days / Next week / a date picker / Remove follow-up; a quick
  choice saves immediately. Follow-up calendar dates use Europe/Dublin.
- Retain the optional business-name Settings nudge, below the hero/attention.
- **Today:** all non-cancelled bookings on today's Ireland date, including completed.
  Row = Ireland time, client, service, full price, work-status chip; tap for detail.
  Empty: **Your day is clear**, or **No bookings yet**, with a + hint.
- **Upcoming:** enquiry/confirmed bookings 1–14 Ireland-local days ahead, grouped by
  Ireland date. Empty: **Nothing in the next two weeks**. **Later** (>14 days)
  and the latest 20 completed/cancelled **Past bookings** are collapsed when present.
  Past open jobs stay in To wrap up. No swipe actions.
- Relative times/grouping refresh each minute and when returning to the tab.
  All targets are at least 44px and respect reduced-motion preferences.

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
Stacked sections: header → details → Next step → More → optional notes →
Money → Client messages. Lead with at most one primary page action.
- **Header:** client name and service, work-status chip plus separate payment
  wording: **Confirmed · €20 deposit due**, **Completed · €55 to pay**,
  **Completed · Paid in full**, or simply **Enquiry / Confirmed / Cancelled**.
  Details retain date/time, location/directions and the client link/mobile.
- **Stage:** shared core `bookingStage(booking, payments, now)` sums only this
  booking's paid payments and clamps owed cents at zero. Confirmed appointments
  are upcoming until their actual start instant, including later today; then
  they are due. This matches Today’s **In X hours** versus **Now** wording.
  Financial Due now totals retain their Ireland-local due-date rule (today or
  earlier); next-step timing does not postpone money already due today.
  Completed jobs are owing or paid; work status is separate.
- **Next step**, directly below details:
  - enquiry: primary **Confirm booking** (or **Confirm & notify <name>** using
    existing automation/mobile wording and caption); quiet **Quote** and
    **Change follow-up**, with the follow-up date or **No follow-up set** here.
  - upcoming: **Booking confirmed**, with preparation wording for the service/date.
    With money owed, show **€X deposit due**, or **€X still to pay**;
    primary **Add payment**
    and quiet **Ask for payment**. Deposit wording never exceeds total owed.
  - upcoming with nothing owed: **All set — paid in full**, and no primary.
    **Mark complete** remains secondary in More, allowing early completion.
  - due: **Ready to finish?**, primary **Mark complete**; when owed, **€X still to pay** and quiet
    **Add payment**.
  - owing: **€X left to pay**, primary **Add payment**, quiet **Ask for payment**.
  - paid: **Paid in full**, primary **Book again**, quiet **Receipt**.
  - cancelled: soft **Book again**, with no primary.
- **More:** a compact list of quiet icon rows, each at least 44px high, not a
  stack of large buttons. Preserve availability and avoid duplicate actions:
  **Quote** for enquiries / **Invoice** otherwise, **Receipt** (unless in Next step), **Add to calendar**,
  **Send confirmation** (unless in Next step), **Book again** (unless in Next
  step; never for enquiries), **Edit** (enquiry/confirmed), **Mark complete**
  (upcoming only, retaining early completion), and payment actions not already
  in Next step. **Ask for payment** remains available for enquiries/due jobs
  with money owed. **Add payment** remains here for confirmed/completed jobs
  when not in Next step, including zero owed; overpayment validation is unchanged.
  **Cancel enquiry/booking** is last, danger-coloured, and only for open jobs.
  No calendar or confirmation action for cancelled jobs. Receipt remains disabled
  without a paid payment, with explanatory text. Respect reduced-motion preferences.
- **Money card:** price, deposit and payment rows with amount, kind and Paid/Due
  chips. Paid rows retain method/date; pending rows optionally offer **Payment
  link** when enabled. Header: **€120 of €350 paid**. No standalone Record/Request
  payment buttons and no per-row Mark paid on booking detail. Money's quick
  Mark paid sheet still offers Cash / Bank transfer / Revolut.
- **Add to calendar:** non-cancelled bookings offer a button opening a Sheet
  with primary **Add to phone calendar** (download an `.ics` file)
  and secondary **Google Calendar (web)** (a prefilled event). Explain
  that this is a one-off copy; automatic updates come from Settings. Works
  in demo too. Booking location opens Google Maps directions in a new tab.
- **Calendar subscriptions (Settings):** replace the Google Calendar “soon”
  connection with **Add bookings to your calendar**. Confirmed and Enquiries
  each have primary **Add to phone calendar** (subscribe) then secondary
  **Google Calendar (web)** links, all at least 44px. Explain:
  “Pick a colour for each calendar in your calendar app. Changes can take a
  few hours to show in Google.” **Reset links** requires confirmation:
  “Old links will stop working.” In demo, disable the controls and show
  “Available when you sign in”; never show fake subscription URLs.
- **Add payment:** the Next step/More action opens the existing **Record payment**
  sheet. Paid manual payment rows are ≥44px buttons opening **Edit payment**
  (amount, method and Ireland-local date). **Undo payment** requires a second
  confirmation explaining that the amount returns to owed, any receipt is
  marked VOID, the audit row remains, and no money is moved. Card-paid rows say
  **Paid by card** and have no correction actions; refund those in Stripe.
  Undone rows remain visible as **Undone**; **Voided receipt** downloads the
  original frozen receipt with a clear VOID marker, not a newly issued receipt.
  Issued receipts block editing: undo and record a new payment instead.
  Actions preserve committed/refresh-error handling and offer Reload rather
  than encouraging a duplicate write. The regular Record payment
  sheet has a euro-prefixed decimal amount
  (defaults to all outstanding), method (Cash / Bank transfer / Revolut), and
  date (defaults to today in Ireland; no future dates). Validate on blur,
  clear errors on edit, focus the first invalid field on submit. Success:
  "Payment recorded". Custom rows are labelled "Payment" and each can have
  its own Receipt. At paid ≥ price show **Paid in full**; Add payment moves to
  More instead of disappearing. Existing limits still prevent overpayments.
  This is the only record/mark-paid action on booking detail; Money keeps its
  quick Mark paid sheet with Cash / Bank transfer / Revolut. Failed saves stay
  open with an inline error. If saving succeeds but reloading fails, explain
  that it was saved, keep the sheet open, and offer Reload instead of letting
  the person record the same payment again.
- **Ask for payment:** the manual-draft Sheet has an editable **Amount to
  request**, initially the balance, from €0.01 to the balance. The draft's
  balance placeholder uses this amount. Include a pending payment link only
  when its amount matches the requested amount; disable draft actions for
  invalid amounts. Opening a draft records nothing; after opening, retain
  **I sent it** and **Close**. Only explicit **I sent it**
  records the request timestamp and user-confirmed contact history; it is not
  verified delivery.
- **Quote:** enquiries have a quiet **Quote** action in Next step using the same PDF
  share/download flow and branding as invoices. Title **Quote**, stable
  **QTE-0001** number and issue date, **Valid until** (issue date + 30 days),
  service/date/price at issue time and VAT breakdown, deposit if positive, and
  **To go ahead, just reply to confirm.** No paid/balance or bank-detail section.
  Newly issued PDFs freeze their visible content, including branding, client
  details, prices, payment details and VAT. Reopening a new document does not
  change it; legacy documents without a snapshot retain live rendering.
  It is a quote, not proof of acceptance or payment. Confirming remains the
  existing Confirm action, and removes Quote availability.
- **Messages (M3):** timeline of message_log rows. Manual acknowledgements say
  **Confirmation / Payment request / Follow-up · you confirmed sending**, not
  verified delivery. Provider-reported rows retain their normal status — "✓ Confirmation sent
  Tue 14:02 · ✓ Reminder sent Fri 10:00". Failed sends show `--danger` with
  the reason. This card is what makes the automation trustworthy — the
  vendor can *see* what their client was sent.
  In demo, label the timeline **Sample activity — nothing was sent**.
- Cancel = confirm dialog stating consequences plainly: "Removes it from
  your calendar. Pending payment links will be cancelled."

### 4. Money — `/money` (M2, M6)
Order: heading → Owed hero → Due now → Coming up → This year → collapsed Tax estimate.

- Shared core `moneyOwed(bookings, payments, now)` uses `bookingStage` and returns
  one item per booking, never per pending row. Owed cents = max(0, price minus
  paid payments); cancelled/pending payment rows do not count as paid.
  Due now = confirmed today/past or completed owing. Coming up = confirmed after
  today in Ireland. Enquiries, cancelled and fully-paid jobs are excluded.
  Missing or duplicate pending rows do not alter these totals.
- **Owed to you:** hero = due-now cents and booking count. **Due now** cards are
  oldest job first. Empty: **Nobody owes you anything. Lovely.**
- **Coming up:** hidden when empty; lighter cards and **€X expected** subtotal
  for future jobs' full remaining amounts. Neither Today nor the Owed hero
  includes these amounts.
- Cards show client, service, amount, kind and Ireland-local job wording:
  **Deposit · job on Wed 18 Nov**, **Balance · job was 2 days ago**, or
  **Full payment · job today**. Kind is Deposit only for future jobs where the
  remaining amount equals the unpaid deposit (payments cover the deposit first);
  otherwise Full payment if nothing received, else Balance.
- Keep **Not asked yet / Asked today / Asked n days ago**, using the booking's
  most recent user-confirmed request timestamp and Ireland-local days.
  **Send reminder** opens the existing editable draft with the booking's owed
  amount, not a pending row's amount. Opening WhatsApp/Email records nothing.
  Use **I sent it / Close** and draft-only wording.
- **Mark paid** offers Cash / Bank transfer / Revolut and records the full owed
  amount via the booking record-payment handler. Existing pending deposits/
  balances are voided, not additionally marked paid. It works without pending
  rows. Preserve inline errors and the committed-save Reload guard.
- **Payment link**, when enabled, is for the same full amount. A tenant-scoped
  booking endpoint reuses a matching pending row or replaces mismatched rows
  with a single pending full-balance row, deactivating voided links after commit.
  Never invent a payment id in the browser; demo follows the same rules.
- **This year:** one card, Ireland-local year/month boundaries, year-to-date only.
  Paid income after recorded VAT, confirmed expenses after reclaimable VAT, and
  profit before income tax use the tax estimate's exact YTD basis.
  Monthly paid-income bars use the same net basis and exclude future receipts.
  Keep **Export for accountant**, downloading the year's cash-basis CSV; no
  changes to the underlying export's financial records.
- **Tax estimate (rough guide):** secondary native disclosure below This year,
  collapsed by default. Expanded: caveat, VAT-period sales/reclaimable VAT and
  estimated VAT due/refund when registered, and income-tax estimate or Settings
  rate prompt. Only nested **How it's worked out** repeats income/expenses/profit,
  explicitly labelling gross amounts, VAT deductions and net YTD workings.
- All actions/disclosures retain 44px targets and reduced-motion support.

### 5. Expenses — `/expenses` (M5)
- Heading copy: **Keep your expenses in one place.**
- Add/edit expense opens in the shared bottom sheet, not above the list.
  Opening, saving and closing keep the list’s scroll position and filters.
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
Calm sections, saving as you go. No Save settings button.

- **Your details:** business name (required), optional personal name, mobile,
  address and review link; fixed EUR currency. If personal name is missing,
  use the business name in greetings and other trader-name contexts.
- **Getting paid:** optional Revolut.me link, IBAN and BIC. Validate and normalise
  only the edited field; blank clears it. These appear in drafts/invoices.
- **Your services:** up to 30 inline name/price/remove rows with 44px remove icons
  labelled Remove <name>. Completed rows and removals save automatically; partial
  new rows are not saved, and invalid edits retain the previous valid row.
  Names are unique case-insensitively; euro prices are stored as integer cents.
  Catalogue changes never change existing bookings or issued documents.
- **VAT & tax:** registered flag, conditional VAT rate/period/number, income-tax rate.
- **Invoices & receipts:** logo, six labelled ≥44px accent swatches including
  Forest green (#14532D), a Custom native colour picker and optional footer.
  No raw hex text input. Presets remain readable on white documents.
- **Customise messages:** native disclosure, collapsed by default. Confirmation
  and payment-request textareas grow with their text. Friendly detail chips
  (Client name, Business name, Date, Time, Service, Amount, Bank details,
  Revolut link, etc.) insert tokens at the cursor, replacing selected text.
  Show Example preview using the existing renderer and sample booking/client,
  not raw braces. Keep Reset to default. These are drafts the trader sends.
- Text debounces, blur flushes, selections save on change. Per-section
  **Saving… / Saved / error** feedback; invalid values stay local with inline
  errors. Requests contain only changed fields, not a full settings snapshot.
  A serial queue preserves in-flight ordering and retries failed fields without
  overwriting newer edits. After a committed save cannot refresh, stop further
  writes and offer Reload; do not pretend the save failed before commit.
  The controller owns that guard independently of retained field patches.
  Reload releases it only after fetching fresh data successfully, resumes
  queued edits, then reloads the screen. Other workflows cannot release it.
- **Messages & payments:** WhatsApp says **Opens a draft in your WhatsApp — you
  press send**, with no connection-status badge. Disabled card links say
  **Coming later**.
- Then Confirmed/Enquiries calendar subscriptions, Google Drive copy, Account/logout.
  Demo retains reset/leave actions; Drive remains hidden in demo.

**First-run welcome — `/welcome`:** one short form: required Business name,
optional Your name, and optional **What do you offer?** with at most three
service name/price rows saved to the shared catalogue. No phone, address or
payment details here. **Save and get started** opens Today; retain the committed
save/Reload guard. Only a missing business name triggers onboarding, not a
missing personal name. No migration or new profile fields are needed.

**Payment details when needed:** before a payment-request draft, or a confirmation
draft with an unpaid deposit, if neither IBAN nor Revolut link is set, show
**How should clients pay you?** first. Offer Revolut.me and IBAN with optional BIC.
**Save and continue** validates, normalises and updates Settings through the
backend, then opens the draft. **Not now** opens the draft without saving.
Either payment method bypasses the prompt. Never claim a draft has been sent.

### 7. Login — `/login` (M1)
Email/password login, optional Continue with Google, Create account and Forgot
password. Signup asks for email, password (at least eight characters) and password
confirmation, then shows Check your email. Verification/reset links expire after
15 minutes. After verification or Google sign-in, profiles with a business name
go to Today; others go to Welcome. Password reset asks for a new password.
Google sign-in remains independently feature-gated as described above.

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

- Every Mark paid / Record payment success toast includes the client and amount:
  **Marked Eimear Kelleher €65.00 paid**. Coming up’s expected total drops by
  the amount recorded; only paid rows count.
- WhatsApp links normalise existing stored client numbers as well as new edits:
  Irish `08…` → `3538…`, `+353` / `00353` → `353`, formatting stripped;
  other `+` international numbers become digits only. Client saves store the
  same digits-only international form.
- Confirmation defaults show **Price: €X** with no deposit/balance breakdown
  when no deposit applies. With a deposit, show **Deposit required** for its
  unpaid portion and **Deposit received** for its paid portion, derived only
  from paid payments. The balance excludes the still-required deposit.
  Optional empty lines (including payment links) are removed cleanly.
- All manual message drafts use **Close** for dismissal. Opening WhatsApp/email
  alone never records Asked or history. After opening, **I sent it** explicitly
  records user-confirmed sending; payment requests also update Asked. No
  acknowledgement issues a receipt or changes income/work status.
- App-wide: while a text control is focused, hide sticky save footers, bottom
  navigation and its floating +. Resizing a desktop window without editable
  focus must not hide controls; there is no retained height baseline.
  Sheet content remains scrollable within the visible height; static form
  buttons remain reachable. Restore controls on blur.

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

## Google Drive copy (Settings)

- Title and button: **Save a copy to Google Drive**. Only signed-in users with
  `features.googleDrive`; hidden in demo and when disabled.
- Explain that issued invoices, receipts, quotes, expense photos and yearly
  money files go in a Sorted folder in their Drive, only when chosen, never
  automatically. Google consent requests access only to app-created files.
- Preload the identity script and lazy module, show Getting ready… until ready,
  and request the token synchronously on the user's click. Preparation failure
  offers Try again. No popup/token request on mount.
- While running: **Saving your copy… / Saving X of Y…**. Announce progress.
  **Last copy saved: today / N days ago** updates only after full completion.
  Success: **Copy saved to Google Drive**; empty: **No files to save yet.**
- Errors stay inline, including runtime errors, with a reason and **Nothing was
  lost**: Google window closed/blocked (allow pop-ups), access not granted,
  network/offline (check connection), or a generic retry fallback. Drive API
  disabled/`accessNotConfigured` 403 says **Google Drive isn't switched on for
  Sorted yet**. Never display raw Google error bodies/tokens.
- Preserve previous completion timestamps on failure, skip already-uploaded
  PDF/photo files on retry except replace newly voided receipt PDFs, and
  refresh yearly CSVs in place, including years with only undone payments.
  Targets ≥44px.

## Accessibility & PWA floor (M8 checklist)

Visible focus rings · chips never rely on colour alone (label text always
present) · 44px targets · `prefers-reduced-motion` respected · Lighthouse
PWA installable pass · offline: cached shell + "You're offline, showing
last-loaded data" banner (read-only offline is enough for MVP).

## Incomplete enquiries

- Date stays prominent in Add booking: ask for it up front, but allow a blank
  date, time and/or price for **Save as enquiry**. No date, time or zero-price
  defaults are invented. **Save booking** requires all three; a repeat requires
  a date. An unknown price cannot have a deposit.
- Show **Date to be agreed**, **Time to be agreed** and **Price to be agreed**
  consistently in details, client history, Today and messages. Date-only
  enquiries use Ireland-local midnight for storage, never as display time.
- **Confirm booking** opens a short sheet containing only missing fields.
  Saving fills them and confirms atomically. Error and committed-refresh
  handling follow other sheets. The same completeness invariant applies to
  cancellation: add the missing details before cancelling an enquiry.
- Today groups dated/time-TBC enquiries under their day, time-TBC first.
  **No date yet** follows the dated groups. Follow-ups work for either kind.
  Only confirmed appointments can become the next-appointment hero.
- Disable no-price payment/quote/invoice actions with **Add a price first**
  guidance. Unknown prices never appear as zero or increase owed/tax totals.
- Hide Add to calendar without a date. Time-TBC enquiries export as all-day
  events; undated enquiries are omitted from the Enquiries feed. Default
  message drafts omit unknown-price lines and use natural agreed-later wording.
- Keep shared sheets, 44px targets, reduced motion and demo parity.
