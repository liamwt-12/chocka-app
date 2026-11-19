export interface AuditItem {
  key: string; label: string; score: number; maxScore: number;
  status: 'red' | 'amber' | 'green'; detail: string;
}
export interface FixItem {
  key: string; label: string; description: string; pointsGain: number;
}
export interface AuditResult {
  score: number; maxScore: number; band: string; bandColour: string;
  items: AuditItem[]; fixes: FixItem[];
}

function mk(key: string, label: string, score: number, max: number, detail: string): AuditItem {
  const pct = max > 0 ? score / max : 1;
  return { key, label, score, maxScore: max, status: pct >= 0.8 ? 'green' : pct >= 0.4 ? 'amber' : 'red', detail };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scoreProfile(data: { location: any; attributes: any; media: any; reviews: any; posts: any; googleUpdated: any }): AuditResult {
  const items: AuditItem[] = [];
  const fixes: FixItem[] = [];
  const loc = data.location;
  const now = Date.now();

  // 1 Description 15
  const desc = loc.profile?.description || '';
  let ds = 0, dd = 'No description set';
  if (desc.length >= 250) { ds = 15; dd = `${desc.length} chars`; }
  else if (desc.length >= 100) { ds = 10; dd = `${desc.length} chars - could be longer`; }
  else if (desc.length > 0) { ds = 5; dd = `Only ${desc.length} chars`; }
  items.push(mk('description', 'Business description', ds, 15, dd));
  if (ds < 15) fixes.push({ key: 'description', label: 'Write your business description', description: 'AI-generated for your trade and area', pointsGain: 15 - ds });

  // 2 Hours 12
  const periods = loc.regularHours?.periods || [];
  const daySet = new Set(periods.map((p: any) => p.openDay));
  let hs = 0, hd = 'Not set';
  if (daySet.size >= 5) { hs = 12; hd = `${daySet.size} days set`; }
  else if (daySet.size > 0) { hs = 6; hd = `Only ${daySet.size} days`; }
  items.push(mk('hours', 'Opening hours', hs, 12, hd));
  // Hours are only ever the shop's own: it types them in and confirms them (lib/opening-hours.ts).
  if (hs < 12) fixes.push({ key: 'hours', label: 'Add your opening hours', description: 'You tell us the times, we put them on Google', pointsGain: 12 - hs });

  // 3 Services 12
  const svcs = loc.serviceItems || [];
  let ss = 0, sd = 'No services listed';
  if (svcs.length >= 6) { ss = 12; sd = `${svcs.length} services`; }
  else if (svcs.length >= 3) { ss = 8; sd = `${svcs.length} services`; }
  else if (svcs.length > 0) { ss = 4; sd = `Only ${svcs.length}`; }
  items.push(mk('services', 'Services listed', ss, 12, sd));
  if (ss < 12) fixes.push({ key: 'services', label: 'Add services to your profile', description: '8-12 services customers search for', pointsGain: 12 - ss });

  // 4 Categories 8
  const addCats = loc.categories?.additionalCategories || [];
  let cs = 0, cd = 'Only primary category';
  if (addCats.length >= 2) { cs = 8; cd = `${addCats.length + 1} categories`; }
  else if (addCats.length === 1) { cs = 4; cd = '2 categories'; }
  items.push(mk('categories', 'Business categories', cs, 8, cd));
  if (cs < 8) fixes.push({ key: 'categories', label: 'Add more categories', description: 'Appear in more searches', pointsGain: 8 - cs });

  // 5 Photos 10
  const photos = data.media?.mediaItems || [];
  let ps = 0, pd = 'No photos';
  if (photos.length >= 6) { ps = 10; pd = `${photos.length} photos`; }
  else if (photos.length >= 3) { ps = 6; pd = `${photos.length} photos`; }
  else if (photos.length > 0) { ps = 3; pd = `Only ${photos.length}`; }
  items.push(mk('photos', 'Photos', ps, 10, pd));

  // 6 Recent photos 5
  const ninety = 90 * 86400000;
  const recentPh = photos.filter((m: any) => m.createTime && (now - new Date(m.createTime).getTime()) < ninety);
  items.push(mk('recentPhotos', 'Recent photos (90 days)', recentPh.length > 0 ? 5 : 0, 5, recentPh.length > 0 ? `${recentPh.length} recent` : 'None'));

  // 7 Reviews 8
  const revs = data.reviews?.reviews || [];
  const replied = revs.filter((r: any) => r.reviewReply).length;
  let rs = 0, rd = 'No reviews';
  if (!revs.length) { rs = 4; rd = 'No reviews yet'; }
  else if (replied === revs.length) { rs = 8; rd = `All ${revs.length} replied`; }
  else if (replied > 0) { rs = 4; rd = `${replied}/${revs.length} replied`; }
  else { rd = `${revs.length} reviews, none replied`; }
  items.push(mk('reviews', 'Reviews replied to', rs, 8, rd));
  // Only 4 and 5 star reviews are offered a drafted reply. Lower ones never get
  // one posted from here, so they are not counted as something we will fix, and
  // the points are only promised when replying would answer every review.
  const unrepGood = revs.filter((r: any) => !r.reviewReply && (r.starRating === 'FOUR' || r.starRating === 'FIVE')).length;
  const unrep = revs.length - replied;
  if (unrepGood > 0) fixes.push({ key: 'reviews', label: `Reply to ${unrepGood} unanswered review${unrepGood === 1 ? '' : 's'}`, description: 'You read each reply before it is posted', pointsGain: unrepGood === unrep ? 8 - rs : replied === 0 ? 4 : 0 });

  // 8-9 Phone Website
  items.push(mk('phone', 'Phone number', loc.phoneNumbers?.primaryPhone ? 5 : 0, 5, loc.phoneNumbers?.primaryPhone ? 'Set' : 'Missing'));
  items.push(mk('website', 'Website', loc.websiteUri ? 5 : 0, 5, loc.websiteUri ? 'Set' : 'Missing'));

  // 10 Attributes 5
  const attrs = data.attributes?.attributes || [];
  const atS = attrs.length >= 4 ? 5 : attrs.length > 0 ? 3 : 0;
  items.push(mk('attributes', 'Profile attributes', atS, 5, attrs.length ? `${attrs.length} set` : 'None'));

  // 11 Service area 5
  items.push(mk('serviceArea', 'Service area', loc.serviceArea ? 5 : 0, 5, loc.serviceArea ? 'Set' : 'Not defined'));

  // 12 Posts 5
  const postList = data.posts?.localPosts || [];
  const thirty = 30 * 86400000;
  const recentPo = postList.filter((p: any) => p.createTime && (now - new Date(p.createTime).getTime()) < thirty);
  items.push(mk('posts', 'Recent Google posts', recentPo.length > 0 ? 5 : 0, 5, recentPo.length ? `${recentPo.length} in last 30 days` : 'None'));
  // The points arrive when the post is actually published, not when it is booked.
  if (!recentPo.length) fixes.push({ key: 'firstPost', label: 'Book your first post', description: 'Goes up tomorrow morning, once you have read it', pointsGain: 0 });

  // 13 Special hours 3
  items.push(mk('specialHours', 'Holiday hours', loc.specialHours?.specialHourPeriods ? 3 : 0, 3, loc.specialHours?.specialHourPeriods ? 'Set' : 'Not set'));

  // 14 Google updates 2
  items.push(mk('googleUpdates', 'Google suggestions', data.googleUpdated ? 0 : 2, 2, data.googleUpdated ? 'Pending' : 'All clear'));

  const score = items.reduce((s, i) => s + i.score, 0);
  const maxScore = items.reduce((s, i) => s + i.maxScore, 0);
  let band = 'Needs serious work', bandColour = '#C93B3B';
  if (score >= 91) { band = 'Exceptional'; bandColour = '#166534'; }
  else if (score >= 76) { band = 'Strong profile'; bandColour = '#2D8A56'; }
  else if (score >= 56) { band = 'Decent but leaving money on the table'; bandColour = '#D49B2B'; }
  else if (score >= 31) { band = 'Below average'; bandColour = '#D4622B'; }
  return { score, maxScore, band, bandColour, items, fixes };
}

export function predictedScore(audit: AuditResult): number {
  return Math.min(audit.score + audit.fixes.reduce((s, f) => s + f.pointsGain, 0), audit.maxScore);
}

/**
 * The gaps the score counts that this app does NOT fill, with how the shop can
 * do each one itself. Said plainly on screen, so the score never implies we
 * will fix something we will not. Pure.
 */
export interface ManualGap { key: string; label: string; why: string; how: string }

const MANUAL: Record<string, Omit<ManualGap, 'key'>> = {
  photos: { label: 'Photos', why: 'We do not add photos for you.', how: 'In Google, open your Business Profile and choose "Add photo". Six or more photos of your showroom and finished jobs is a good start.' },
  recentPhotos: { label: 'A recent photo', why: 'We do not add photos for you.', how: 'Add one new photo every month or two. A phone photo of a finished job is ideal.' },
  website: { label: 'Website', why: 'We do not guess a website for you.', how: 'If you have one, type it in under Settings here and we will put it on your listing. If you have none, leave it.' },
  attributes: { label: 'Extra details (payment, access)', why: 'We do not set these, because only you know them.', how: 'In Google, open "Edit profile", then "More", and tick what applies: card payments, wheelchair access, appointments.' },
  serviceArea: { label: 'Area you cover', why: 'We do not set this for you.', how: 'In Google, open "Edit profile", then "Location", and add the towns you fit in.' },
  specialHours: { label: 'Holiday hours', why: 'These are your decision, so we only set them when you tell us.', how: 'Add your bank holiday and Christmas hours in Settings here, or in Google under "Hours".' },
  googleUpdates: { label: 'Changes Google is suggesting', why: 'Google wants you to accept or reject its own suggested edits.', how: 'Open your Business Profile in Google and look for a notice about suggested changes.' },
  phone: { label: 'Phone number', why: 'We do not set a phone number for you.', how: 'In Google, open "Edit profile", then "Contact", and add the number customers should ring.' },
};

export function manualGaps(audit: AuditResult): ManualGap[] {
  return audit.items
    .filter((i) => i.score < i.maxScore && MANUAL[i.key])
    .map((i) => ({ key: i.key, ...MANUAL[i.key] }));
}
