# Offboarding email — legacy Chocka users (DRAFT, for sign-off)

Status: **draft — not sent.** Send after sign-off, before running `scripts/offboard-legacy-users.ts`.

Cohort: the legacy Chocka test users (see the roster in the session report). None has an active Stripe subscription, so no billing needs cancelling. Decide separately whether to include the founder's own accounts (`liam@wearecanny.uk`, `liamherb21@gmail.com`) — the cleanup script excludes `liam@wearecanny.uk` by default.

- **From:** Chocka <hello@chocka.co.uk>
- **Reply-to:** team@chocka.co.uk
- **Subject:** Winding down your Chocka connection

---

Hi {{first_name}},

Thanks for giving Chocka a try.

We're stepping back from taking on new Chocka work while we focus our time elsewhere, so we're gently closing down the test accounts, including yours.

Here's what that means for you:

- We'll disconnect Chocka from your Google Business Profile. You don't need to do anything.
- **Nothing on your Google profile changes.** Your listing, reviews, photos, and posts all stay exactly as they are and remain fully yours.
- After this, Chocka won't access or post to your profile again.

If you'd ever like to manage your own listing directly, you can do that any time by signing in at business.google.com.

Thanks again for trying it out, it genuinely helped us learn. If there's anything we can help with as we wind down, just reply to this email.

All the best,
The Chocka team
team@chocka.co.uk

---

### Notes for send
- Personalise `{{first_name}}` per recipient (roster has names; a couple are business names, so a plain "Hi there" fallback is fine where there's no clean first name).
- Plain-text or the existing Resend template both work; keep it plain and personal rather than heavily branded.
- Send, allow a day or two for anyone to reply, then run the cleanup script.
