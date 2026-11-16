# DRAFT, needs solicitor review

> Not published. Not legal advice. Written 16 November 2026 from what the code does (PR #39, shop photos, and the deletion work in this PR). It adds photos to the draft privacy policy in `privacy-policy.md` (PR #30). **`SHOP_PHOTOS` is off, and should stay off until this wording has been reviewed and published.** Square brackets mark things to confirm.

## Why this is needed

The draft privacy policy was written before shops could send us photos. Photos are a new kind of data: a picture of a finished job is usually taken **inside a customer's home**, and can show people, a house number or a car registration. The policy has to say that we hold them, what we do with them, and when they go.

## The short version (one line, for anywhere a single line is wanted)

> **Photos you send us.** If you or your Tarkett rep upload photos of your work, we remove the hidden details phones add (including where each photo was taken), keep the photos privately, and use one on your Google posts only after a person at Stellar Local has approved it. You can ask us to remove any photo at any time, and all of them are deleted if you close your account.

## The full wording, by section of `privacy-policy.md`

### Section 3, "What we collect, and where it comes from": add one row

| What | Where it comes from |
|---|---|
| Photos of your work, if you choose to send any: the pictures themselves, their size, and when they were uploaded | You, or your Tarkett rep on your behalf, through an upload link we give you |

And one sentence under the table:

> Before a photo is saved we remove the hidden information a phone attaches to it, including the location it was taken at, the date and time, and the make of phone. We keep the picture and nothing else.

### Section 4, "What we do with it, and our lawful basis": add one row

| Purpose | Lawful basis (UK GDPR Article 6) |
|---|---|
| 4.8 Using photos you have sent us on your Google posts [and, if you ask us to, in your listing's photo gallery], after we have checked each one | Contract: it is part of the service you signed up for, and only happens if you send photos. [Solicitor: is contract right, or should this be consent, given that sending photos is optional and a photo may show a third party? See question 2 below.] |

### Section 5, "AI, and what happens automatically": add one bullet

> - **Photos.** A photo is never used until a person at Stellar Local has looked at it and approved it. Once approved, it may be attached to one of your weekly posts. Photos are not sent to the AI model.

### Section 6, "Who processes data for us": change one row

| Provider | What for | Where |
|---|---|---|
| Supabase | Database, **and private storage for photos** | Ireland (EU) [confirm the storage region matches the database] |

And a sentence on Google, which is the one place a photo becomes public:

> When a photo is used on a post it is published on your Google Business Profile, where anyone can see it, under Google's own terms.

### Section 7, "What Tarkett sees": add one sentence

> Tarkett does not see your photos through us. A Tarkett rep who uploads photos for you has, of course, seen the ones they uploaded. [Liam: confirm reps are Tarkett staff and that this is how it will work in practice.]

### Section 8, "How long we keep it": add rows

| Data | How long |
|---|---|
| A photo we decide not to use | The file is deleted at once. We keep a note that a photo was declined, with no picture attached. |
| Photos we hold for you | Until you ask us to remove one (email privacy@stellarlocal.co.uk or tell your rep), which we do [within 2 working days: Liam to confirm a period he can keep]. All of them are deleted straight away if you delete your account, and with your record if it is removed. |
| A photo already published on a Google post | It stays on your Google listing until the post is deleted. You can delete it yourself in your Google Business Profile, or ask us to. |
| The link we give you to upload photos | Stops working after 30 days, or sooner if we cancel it. It is cancelled when you delete your account. |

### New short section, suggested as 4a or within section 3: "Other people in your photos"

> Please only send photos you took yourself or have permission to use, and avoid photos that show customers' faces, house numbers or car registrations. We check each photo before using it and will not use one that identifies someone. If a photo you sent shows a person, you are responsible for having their agreement. If anyone asks us to remove a photo they appear in, we will.

## What the code actually does (so the wording can be checked against it)

| Claim in the wording | What happens | Where |
|---|---|---|
| Hidden details removed, including location | Every upload is rebuilt keeping only the picture. GPS position, time, device, embedded thumbnails and any attached video are dropped. A second check reads the file back and refuses it if anything is left. | `lib/image-metadata.ts`, `preparePhoto` in `lib/shop-photos.ts` |
| Kept privately | A private storage bucket. Files can only be reached through short-lived addresses made by our server. | Migration `20261116100000_shop_photos` |
| Not used until a person approves | New photos are "pending". Only "approved" ones are attached to posts, and that is checked again at the moment of publishing. | `pickPhotoForPost`, `photoUrlForPost` |
| Declined photo deleted at once | Rejecting a photo deletes the file. | `/api/admin/photos`, action `reject` |
| Deleted when the account is deleted | Files and photo records are both deleted, and the upload link is cancelled. | `/api/account/delete` (this PR) |
| Deleted with the shop's record | Files are deleted first; the record is only removed once they are confirmed gone. | `/api/cron/retailer-retention` (this PR) |
| Not sent to the AI model | No photo or photo address is included in any model request. | `lib/ai.ts` |

Two honest limits to tell the solicitor about:

1. **A photo on a published Google post is outside our storage.** Deleting it from our side does not take it off Google. The wording above says so.
2. **If the automatic delete fails** when an account is closed (storage unavailable, for instance), the account is still closed and the failure is logged for us to clear by hand. So "straight away" is true in the normal case and "as soon as we can" in the failure case. [Solicitor: is "straight away" acceptable, or should it say "without undue delay"?]

## Questions for the solicitor (photos only)

1. **Is the short version enough on the upload page itself**, or does the page need to link to the full policy? The page currently says: "Photos you took, or have permission to use. No customers' faces, house numbers or number plates. We remove the hidden details phones add to photos, including where each one was taken, before anything is saved."
2. **Lawful basis.** Contract (part of the service) or consent (sending photos is optional)? If consent, how should withdrawing it work for a photo already published on Google?
3. **Third parties in photos.** A photo of a fitted floor is the inside of someone's home. With location data removed and no address attached, is that personal data about the homeowner at all? Is "the shop is responsible for having permission" a fair allocation, and should it be in the terms as well as the privacy policy?
4. **Who is the controller for a photo a Tarkett rep uploads** on a shop's behalf: us, the shop, or does the rep's involvement bring Tarkett in?
5. **Does the Article 14 notice need a line on photos?** Photos only ever come from shops that have joined, so we think not.

## Not in this draft

- No change to `privacy-policy.md` itself: that file is in PR #30. This document is the insert, to be merged into it by whoever does the solicitor's edits.
- The terms of service probably need a matching clause (the shop confirms it has the right to use each photo, and lets us publish it). Not drafted here.
