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
  if (hs < 12) fixes.push({ key: 'hours', label: 'Set your opening hours', description: 'Default trade hours, adjustable', pointsGain: 12 - hs });

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
  const unrep = revs.length - replied;
  if (unrep > 0) fixes.push({ key: 'reviews', label: `Reply to ${unrep} unanswered review${unrep === 1 ? '' : 's'}`, description: 'AI replies in your voice', pointsGain: rs < 8 ? 8 - rs : 0 });

  // 8-9 Phone Website
  items.push(mk('phone', 'Phone number', loc.phoneNumbers?.primaryPhone ? 5 : 0, 5, loc.phoneNumbers?.primaryPhone ? 'Set' : 'Missing'));
  items.push(mk('website', 'Website', loc.websiteUri ? 5 : 0, 5, loc.websiteUri ? 'Set' : 'Missing'));

  // 10 Attributes 5
  const attrs = data.attributes?.attributes || [];
  const atS = attrs.length >= 4 ? 5 : attrs.length > 0 ? 3 : 0;
  items.push(mk('attributes', 'Profile attributes', atS, 5, attrs.length ? `${attrs.length} set` : 'None'));
  if (atS < 5) fixes.push({ key: 'attributes', label: 'Set profile attributes', description: 'Payment methods, accessibility', pointsGain: 5 - atS });

  // 11 Service area 5
  items.push(mk('serviceArea', 'Service area', loc.serviceArea ? 5 : 0, 5, loc.serviceArea ? 'Set' : 'Not defined'));

  // 12 Posts 5
  const postList = data.posts?.localPosts || [];
  const thirty = 30 * 86400000;
  const recentPo = postList.filter((p: any) => p.createTime && (now - new Date(p.createTime).getTime()) < thirty);
  items.push(mk('posts', 'Recent Google posts', recentPo.length > 0 ? 5 : 0, 5, recentPo.length ? `${recentPo.length} in last 30 days` : 'None'));
  if (!recentPo.length) fixes.push({ key: 'firstPost', label: 'Schedule your first post', description: 'Goes live tomorrow morning', pointsGain: 5 });

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
