const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

async function callClaude(system: string, user: string, maxTokens = 300): Promise<string> {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API failed: ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text;
}

export async function generatePost(params: {
  businessName: string; category: string; city: string;
  month: string; season: string; recentPosts: string[];
}): Promise<string> {
  const system = `You write Google Business Profile posts for UK tradespeople. British English. Sound like a real tradesperson - friendly, professional, no corporate speak. No hashtags. One emoji max. 2-3 sentences. Soft call to action. Never repeat themes from recent posts.`;
  const user = `Business: ${params.businessName}\nTrade: ${params.category}\nLocation: ${params.city}\nMonth: ${params.month}\nSeason: ${params.season}\nRecent posts to avoid:\n${params.recentPosts.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nWrite a new post.`;
  return callClaude(system, user);
}

export async function generateReviewReply(params: {
  businessName: string; category: string; reviewerName: string;
  rating: number; comment: string;
}): Promise<string> {
  const tone = params.rating >= 4 ? 'warm, grateful, genuine' : 'professional, empathetic, constructive';
  const system = `You write review replies for UK tradespeople. British English. Sound real, not corporate. Be ${tone}. 2-3 sentences. Use reviewer's first name. Never defensive about negatives.`;
  const user = `Business: ${params.businessName}\nTrade: ${params.category}\nReviewer: ${params.reviewerName}\nRating: ${params.rating}/5\nComment: ${params.comment || '(no comment)'}\n\nWrite a reply.`;
  return callClaude(system, user);
}

export async function generateDescription(params: {
  businessName: string; category: string; city: string;
  existingDescription?: string; serviceArea?: string;
}): Promise<string> {
  const system = `You write Google Business Profile descriptions for UK tradespeople. British English, first person ("We're..."). Sound like a real tradesperson - friendly, professional, trustworthy. No marketing fluff. Include what they do, where they cover, reliability, soft call to action. 150-250 words. No hashtags, no emojis, no "Contact us today!" rubbish.`;
  const user = `Business: ${params.businessName}\nTrade: ${params.category}\nLocation: ${params.city}\n${params.serviceArea ? `Service area: ${params.serviceArea}` : ''}\n${params.existingDescription ? `Current (improve): ${params.existingDescription}` : 'None - write from scratch.'}\n\nWrite a description.`;
  return callClaude(system, user, 500);
}

export async function generateServices(params: {
  businessName: string; category: string; existingServices?: string[];
}): Promise<string[]> {
  const system = `Generate service lists for UK tradespeople Google Business Profiles. Return ONLY a JSON array of strings. No explanation, no markdown, no backticks. 8-12 services customers would search for. Plain British English. Be specific.`;
  const user = `Trade: ${params.category}\nBusiness: ${params.businessName}\n${params.existingServices?.length ? `Already listed: ${params.existingServices.join(', ')}` : 'None listed.'}\n\nReturn JSON array of 8-12 services.`;
  const response = await callClaude(system, user, 400);
  try {
    return JSON.parse(response.replace(/```json\s*/g, '').replace(/```/g, '').trim());
  } catch {
    return response.split('\n').map(l => l.replace(/^[\d\-.*]+\s*/, '').trim()).filter(l => l.length > 0 && l.length < 60);
  }
}

export async function suggestCategories(params: {
  primaryCategory: string; businessName: string;
}): Promise<string[]> {
  const system = `Suggest additional Google Business Profile categories for UK tradespeople. Return ONLY a JSON array of strings. Must be real GBP categories. 2-4 that complement the primary. Be accurate.`;
  const user = `Primary: ${params.primaryCategory}\nBusiness: ${params.businessName}\n\nReturn JSON array of 2-4 categories.`;
  const response = await callClaude(system, user, 200);
  try {
    return JSON.parse(response.replace(/```json\s*/g, '').replace(/```/g, '').trim());
  } catch {
    return [];
  }
}
