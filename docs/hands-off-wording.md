# Hands-off mode: the wording a shop agrees to

**DRAFT. Needs solicitor review before `HANDS_OFF_MODE` is switched on.**

Hands-off mode lets a shop choose, once, to have posts and review replies go out
without being asked each time. Choosing it is the shop's permission, so the
exact words on the screen matter. They live in one place in the code
(`lib/automation-mode.ts`) with a version, and the version is stored with each
shop's choice along with the time it was made.

Wording version: `2026-11-19-draft`

## What the shop sees

Title: **How would you like us to work?** "Choose one. Nothing has been posted or changed yet."

### Hands-off

> We post and reply for you until you say otherwise.
>
> - We put a short post on your Google listing each week. You see each one before it goes up and can stop it.
> - We reply to your 4 and 5 star reviews.
> - If you get a 1, 2 or 3 star review we post one short, polite reply that asks the customer to contact you, and we tell you straight away. It is the same careful wording every time.
> - Pause and Undo are always one tap away in Settings.
>
> The reply to a 1, 2 or 3 star review reads: "Thank you for your feedback. We're sorry to hear your experience wasn't what you hoped for. We'd like to understand more, so please contact us directly and we'll look into it."
>
> By choosing Hands-off you give [brand] permission to post and reply on your Google listing for you, as described here, until you tell us to stop.

Button: **Yes, look after it for me**

### Ask me first

> Nothing goes on your listing unless you have said yes to it.
>
> - Posts and review replies are off until you turn them on.
> - You approve your first three posts before they go up.
> - A reply to a 1, 2 or 3 star review always waits for you.

Button: **Ask me first**

## How the permission is recorded

| Stored | Meaning |
|---|---|
| the mode | hands-off or ask me first; empty until the shop chooses |
| when it was chosen | the moment the button was pressed |
| when permission was given | the moment hands-off was chosen; kept if the shop later switches back |
| wording version | which version of the words above was on the screen |
| paused since | set while the shop has pressed Pause |

The server refuses a hands-off choice that does not name the current wording
version, so a permission can always be matched to the words that were shown.

## What happens when a shop changes its mind, or the switch is turned off

- **Choosing "Ask me first" after Hands-off** turns posts and replies off again, and a post that was booked without the shop approving it itself goes back to waiting. The shop then turns on what it wants.
- **Pause** drops any booked post. Nothing is written, published or replied to until Resume, and a review that arrives meanwhile is not answered afterwards.
- **If `HANDS_OFF_MODE` is switched off**, a shop that chose Hands-off is treated as "Ask me first": the switches that choice turned on do not count, and a booked post among its first three goes back to waiting.
- **If the wording changes**, give it a new version and decide whether the old version stays on the accepted list (`ACCEPTED_WORDING_VERSIONS`). A permission against a version that is not on the list stops counting, and the shop is asked again.
- The holding reply is only posted on its own for a review **left after** the permission was given, and only when the rating is plainly 1, 2 or 3 stars.
- The choice cannot be recorded until the old unsigned sign-in cookie is refused (`SESSION_ACCEPT_LEGACY_COOKIE=false`).

## Questions for the solicitor

1. For the funder's shops the Hands-off option is shown **selected** when the
   screen opens, and the shop gives permission by pressing the button under the
   permission sentence. Is a selected option plus a button press enough, or
   should the shop have to tick an empty box?
2. Is the permission sentence wide enough for weekly posts and for both kinds of
   reply, and narrow enough not to cover anything else?
3. The low-star reply is fixed wording, never written by AI. Is "the same
   careful wording every time" a fair description of it?
4. Should the privacy notice or terms mention this mode?

## What never changes, whichever is chosen

- A listing nobody has confirmed, or that Google has not verified, has nothing
  posted to it or replied on it.
- Every change is logged and can be undone from Settings.
- A shop that has not chosen is treated as "Ask me first".
