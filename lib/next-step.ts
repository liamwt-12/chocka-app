/**
 * The one most useful thing a shop could do next, for its dashboard.
 *
 * A score out of 100 with a list of fourteen things is a lot to take in. This
 * picks one: the gap that matters most to a customer looking the shop up, with
 * who can fix it (us, with a press, or only the shop) and where. It is worked
 * out from what the dashboard has already read from Google, so it costs
 * nothing extra, and it changes as soon as the gap is closed.
 *
 * Order: can a customer reach you and find you open, before anything cosmetic.
 * Pure. It never claims a result ("more calls"): only what is missing.
 */
export interface ListingFacts {
  hoursSet: boolean;
  hasPhone: boolean;
  descriptionLength: number;
  servicesCount: number;
  photos: number;
  hasWebsite: boolean;
  unrepliedGood: number;
  unrepliedLow: number;
  waitingPosts: number;
  postsOn: boolean;
  lastPostDaysAgo: number | null;
}

export interface NextStep { key: string; title: string; why: string; button: string; href: string; byUs: boolean }

export function nextBestStep(f: ListingFacts): NextStep | null {
  if (f.waitingPosts > 0) return { key: 'approve_post', title: f.waitingPosts === 1 ? 'A post is waiting for you' : `${f.waitingPosts} posts are waiting for you`, why: 'It will not go up until you have read it and pressed Approve.', button: 'Read it', href: '#top', byUs: true };
  if (!f.hoursSet) return { key: 'hours', title: 'Add your opening hours', why: 'Your Google listing shows no opening hours. People often check before setting off.', button: 'Add my hours', href: '/settings#listing', byUs: true };
  if (!f.hasPhone) return { key: 'phone', title: 'Add a phone number in Google', why: 'Your listing has no phone number, so there is no Call button. Only you can add this, in Google under "Edit profile", then "Contact".', button: 'Open Google Business Profile', href: 'https://business.google.com/', byUs: false };
  if (f.unrepliedLow > 0) return { key: 'low_reviews', title: f.unrepliedLow === 1 ? 'A lower-rated review has no reply' : `${f.unrepliedLow} lower-rated reviews have no reply`, why: 'People read how a shop answers a complaint. We can draft a short, careful reply for you to approve; we never post one for you.', button: 'See what we could improve', href: '/onboarding', byUs: true };
  if (f.descriptionLength < 100 || f.servicesCount < 3) return { key: 'basics', title: 'Fill in what you do', why: f.descriptionLength < 100 ? 'Your listing has little or no description of the shop.' : 'Your listing lists few or no services.', button: 'See what we could improve', href: '/onboarding', byUs: true };
  if (f.photos < 3) return { key: 'photos', title: 'Add a few photos in Google', why: `Your listing has ${f.photos === 0 ? 'no photos' : f.photos === 1 ? 'one photo' : `${f.photos} photos`}. We do not add photos for you. A phone photo of the showroom and two finished jobs is a good start: in Google, choose "Add photo".`, button: 'Open Google Business Profile', href: 'https://business.google.com/', byUs: false };
  if (f.unrepliedGood > 0) return { key: 'good_reviews', title: f.unrepliedGood === 1 ? 'A good review has no reply' : `${f.unrepliedGood} good reviews have no reply`, why: 'We can draft a reply to each for you to read before it is posted.', button: 'See what we could improve', href: '/onboarding', byUs: true };
  if (!f.hasWebsite) return { key: 'website', title: 'Add your website, if you have one', why: 'Your listing has no website. If you have one, type it in and we will put it on your listing. If not, ignore this.', button: 'Add my website', href: '/settings#listing', byUs: true };
  if (!f.postsOn && (f.lastPostDaysAgo === null || f.lastPostDaysAgo > 30)) return { key: 'posts', title: 'Your listing has had no post for a while', why: 'A short post now and then shows the shop is open and active. We can write one each week for you to approve. It is off until you turn it on.', button: 'Turn it on in Settings', href: '/settings', byUs: true };
  return null;
}
