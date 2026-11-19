/**
 * What to tell a shop whose sign-in with Google did not finish, and what to
 * tell whoever is helping it. One place, so the shop's screen, /admin/pilot and
 * support all use the same words for the same thing.
 *
 * Every reason has: what happened (no blame), what to do next, and whether
 * trying again with the same invite will work.
 */
export type HelpReason = 'cancelled' | 'unticked' | 'no_listing' | 'wrong_account' | 'google_error' | 'unknown';

export const HELP_REASONS: HelpReason[] = ['cancelled', 'unticked', 'no_listing', 'wrong_account', 'google_error', 'unknown'];

export interface HelpText {
  /** Heading on the shop's screen. */
  title: string;
  /** One or two plain sentences: what happened. */
  what: string;
  /** What the shop should do now. */
  next: string[];
  /** The button. */
  button: string;
  /** For whoever is helping: the short label and what to suggest. */
  supportLabel: string;
  supportAction: string;
}

export const HELP: Record<HelpReason, HelpText> = {
  cancelled: {
    title: 'You stopped at Google\'s screen',
    what: 'Nothing has been connected and nothing has changed on your listing.',
    next: [
      'Google asks permission for us to "see, edit, create and delete your Google business listings". That is the one permission that lets us keep your listing up to date. It does not let us read your emails, your photos or your files.',
      'You stay the owner, and you can remove us at any time in Google.',
    ],
    button: 'Try again',
    supportLabel: 'Said no at Google',
    supportAction: 'Ring them. Explain that the permission only covers the shop\'s Google listing and can be removed at any time. Ask them to open the same link again and press Continue.',
  },
  unticked: {
    title: 'One box was left unticked',
    what: 'You signed in, but Google\'s screen had a box that needs ticking and it was left empty, so Google did not let us see your listing. Nothing has been connected.',
    next: [
      'Press the button below. On Google\'s screen, look for the line about "Google business listings" and tick the box beside it. On some phones you need to scroll down to see it.',
      'Then press Continue.',
    ],
    button: 'Try again and tick the box',
    supportLabel: 'Box not ticked',
    supportAction: 'Ask them to open the same link, and on Google\'s screen tick the box that mentions business listings before pressing Continue.',
  },
  no_listing: {
    title: 'That Google account does not look after your shop\'s listing',
    what: 'You signed in, but the Google account you used does not manage any shop on Google Maps. Nothing has been connected, and your link still works.',
    next: [
      'Most people have more than one Google account. Use the one you would use to reply to a review or change your opening times.',
      'If somebody else set up your listing (a relative, a web designer, a previous owner), forward your invitation to them and ask them to open it, or ask them to add you as a manager in Google.',
    ],
    button: 'Try a different Google account',
    supportLabel: 'Wrong Google account',
    supportAction: 'Ask who set the shop up on Google Maps. That person should open the same link and sign in. If nobody has access, the shop needs to claim its listing with Google first.',
  },
  wrong_account: {
    title: 'Not your shop?',
    what: 'The Google account you used looks after other listings, but not the one this invitation is for.',
    next: [
      'Sign in with the Google account that looks after this shop. Your link still works.',
      'If somebody else looks after the listing, forward your invitation to them.',
    ],
    button: 'Try a different Google account',
    supportLabel: 'Wrong Google account',
    supportAction: 'Ask them to open the same link and sign in with the Google account that manages this shop.',
  },
  google_error: {
    title: 'Google did not answer',
    what: 'We asked Google for your listing and it did not reply. Nothing is wrong with your account, and nothing has been connected yet.',
    next: ['This is nearly always temporary. Wait a minute and try again.'],
    button: 'Try again',
    supportLabel: 'Google error',
    supportAction: 'Ask them to open the same link and try again in a few minutes. If several shops report this at once, tell Stellar.',
  },
  unknown: {
    title: 'That did not work',
    what: 'Something went wrong while connecting. Nothing has changed on your listing.',
    next: ['Please try again. If it happens twice, tell us and we will sort it out.'],
    button: 'Try again',
    supportLabel: 'Did not finish',
    supportAction: 'Ask them to open the same link and try again.',
  },
};

export function isHelpReason(x: unknown): x is HelpReason {
  return typeof x === 'string' && (HELP_REASONS as string[]).includes(x);
}

/** The address of the help page for this reason, carrying the shop's signed invite reference when there is one. */
export function helpPath(why: HelpReason, inviteRef?: string | null): string {
  return `/connect-help?why=${why}${inviteRef ? `&invite=${encodeURIComponent(inviteRef)}` : ''}`;
}
