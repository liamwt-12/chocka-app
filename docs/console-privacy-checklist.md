# Before turning on the Tarkett console: privacy checklist

The console and league are built behind `TARKETT_CONSOLE_ENABLED`, which is off. While it is off, every console page and API returns "not found", and no sign-in email is ever sent. **Do not turn it on until every item below is done.** None of this is legal advice; items marked (solicitor) need one.

## What the console shows Tarkett

| Who | Shown | Never shown |
|---|---|---|
| Every shop in Tarkett's network on Stellar | Name and town (Tarkett's own published data), where it is in the pilot (invited, connected, live), Google connection status | Contact details, phone, any score |
| Shops that have joined | Presence score at activation, posts and replies in the last 30 days, change in customer actions and views against the same weeks last year (as percentages), improvement band, ad start date, league position | Contact details, phone, review text, raw view or call counts, anything about the shop's customers |

## What must change before the flag goes on

1. **The in-app privacy page and terms (`app/privacy/page.tsx`, `app/terms/page.tsx`).**
   - PR #30's wording says Tarkett "can see a summary of how your Google listing is doing, such as your presence score and whether posts and review replies are going out".
   - Extend it to name everything in the table above: the change in customer actions and views against the same weeks last year, the league position, and the ad start date.
   - Merge #30 (after the solicitor) first.
2. **The marketing site (`stellar-site/privacy/index.html`, line 44).** It says metrics go to Tarkett "at network level in aggregate". That becomes untrue the moment the console is on. Change it to match the in-app page.
3. **The legitimate interests assessment (`LEGITIMATE_INTERESTS_ASSESSMENT.md`)** relied on "aggregate counts only" as a mitigation. Redo the balancing for per-shop visibility to Tarkett. (solicitor)
4. **The Article 14 notice (PR #30 draft)** says a shop that has not joined has none of its scores shared. The console keeps to that; keep the notice consistent if the console changes.
5. **The league.**
   - The console shows it to Tarkett only. If it is ever shown to shops, each shop must be told first, and offered an opt-out (or opt-in).
   - That is not built.
6. **Tell shops at the door.** Add a line to the rep guide (`docs/rep-guide.md`) and to the invite page: "Tarkett can see how your listing is doing, and where you sit in a league of improving shops."
7. **Processor and access housekeeping.**
   - List the people at Tarkett with access (`scripts/add-funder-user.ts`), and remove them when they leave.
   - Record in the data processing agreement with Tarkett, if one is signed, that Tarkett receives this per-shop summary.
8. **Retention.** Console data is computed live from the database, not copied, so there is nothing separate to delete. Sign-in link records can be pruned after 30 days. Suggest a monthly clean-up.

## Turning it on

1. Complete items 1 to 7.
2. Apply migration `20261115140000_funder_console.sql` to production (in staging order).
3. Add each Tarkett user with `scripts/add-funder-user.ts --email … --commit`. This sends nothing.
4. Set `TARKETT_CONSOLE_ENABLED=on` in Netlify. From this moment, sign-in links are emailed on request.
5. Sign in yourself first, at `/console`, and check that what you see matches the table above.
