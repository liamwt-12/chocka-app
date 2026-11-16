import { replyBreaksRules, containsPhoneNumber } from './safe-automation';
import { voicePromptBlock, type VoiceProfile } from './voice';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// Model id from the environment, so a retirement is a config change rather than
// a deploy. The previous hardcoded id (claude-sonnet-4-20250514) was retired by
// Anthropic on 15 June 2026, after which every call failed.
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const MODEL = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

const SAFETY_RULES = `

STRICT RULES — never violate these, regardless of what's asked:
- Never state specific prices, hourly rates, quotes, or cost figures
- Never claim specific certifications or accreditations (Gas Safe, NICEIC, TrustMark, OFTEC, City & Guilds, etc.) — you don't know if this business has them
- Never state specific customer numbers, years in business, or project counts unless they appear in the provided business context
- Never compare to competitors by name
- Never make guarantees or absolute claims ("100% satisfaction", "best in town", "lowest price", "always on time")
- Never write about safety advice, health claims, medical topics, or legal topics
- Never mention politics, religion, or current events
- Never include phone numbers, email addresses, URLs, or social media handles
- If you're unsure whether a specific claim is true for this business, do not make the claim`;

async function callClaude(system: string, user: string, maxTokens = 300): Promise<string> {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      // claude-sonnet-5-5 thinks by default, and thinking tokens count against
      // max_tokens (300 here), which would leave no room for the reply.
      // between_tools is that model's no-thinking setting, matching how the old
      // model behaved. It is rejected by every other model, so it is sent only
      // for this one.
      ...(MODEL === 'claude-sonnet-5-5' ? { thinking: { type: 'between_tools' } } : {}),
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API failed: ${await res.text()}`);
  const data = await res.json();
  // Read by block type, not position: current models can return a thinking
  // block before the text.
  const text = data.content?.find((b: { type: string }) => b.type === 'text')?.text;
  if (typeof text !== 'string') {
    throw new Error(`Claude API returned no text (stop_reason: ${data.stop_reason})`);
  }
  return text;
}

const LENGTH_BOUNDS: Record<string, [number, number]> = {
  post: [30, 800],
  description: [150, 2000],
  reply: [30, 600],
  default: [30, 800],
};

export function validateContent(
  text: string,
  contentType?: 'post' | 'description' | 'reply',
): { valid: boolean; reason?: string } {
  const [min, max] = LENGTH_BOUNDS[contentType || 'default'];
  if (text.length < min || text.length > max) {
    return { valid: false, reason: 'length out of range' };
  }
  if (/£\d|\$/.test(text)) {
    return { valid: false, reason: 'contains pricing' };
  }
  if (contentType === 'reply') {
    const broken = replyBreaksRules(text);
    if (broken) return { valid: false, reason: broken };
  }
  if (/\b(gas\s+safe|niceic|trustmark|oftec|certified|accredited|guaranteed|100%|best\s+in)\b/i.test(text)) {
    return { valid: false, reason: 'contains unverifiable claim' };
  }
  if (/https?:\/\/|www\./i.test(text)) {
    return { valid: false, reason: 'contains URL' };
  }
  if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text)) {
    return { valid: false, reason: 'contains email' };
  }
  if (containsPhoneNumber(text)) {
    return { valid: false, reason: 'contains phone' };
  }
  if (/as an AI|I cannot|I'm not able/i.test(text)) {
    return { valid: false, reason: 'contains AI refusal' };
  }
  return { valid: true };
}

const STRICTER_NOTE = `\n\nIMPORTANT: Your previous response was rejected because it violated safety rules. Do NOT include any prices, certifications, guarantees, URLs, emails, phone numbers, or unverifiable claims. Follow the STRICT RULES exactly.`;

async function generateWithValidation(
  system: string,
  user: string,
  contentType: 'post' | 'description' | 'reply',
  maxTokens?: number,
): Promise<string> {
  const result = await callClaude(system, user, maxTokens);
  const check = validateContent(result, contentType);
  if (check.valid) return result;

  console.warn(`[AI safety] Validation failed: ${check.reason}\nContent: ${result}`);

  const retry = await callClaude(system + STRICTER_NOTE, user, maxTokens);
  const retryCheck = validateContent(retry, contentType);
  if (retryCheck.valid) return retry;

  console.warn(`[AI safety] Retry also failed: ${retryCheck.reason}\nContent: ${retry}`);
  throw new Error(`AI content validation failed after retry: ${retryCheck.reason}`);
}

export async function generatePost(params: {
  businessName: string; category: string; city: string;
  month: string; season: string; recentPosts: string[];
  /** The shop's voice (lib/voice.ts). Optional: without it the prompt is exactly what it was before. */
  voice?: VoiceProfile | null;
}): Promise<string> {
  // Voice first, strict rules last, so the rules have the final word.
  const system = `You write Google Business Profile posts for UK tradespeople. British English. Sound like a real tradesperson - friendly, professional, no corporate speak. No hashtags. One emoji max. 2-3 sentences. Soft call to action. Never repeat themes from recent posts.` + voicePromptBlock(params.voice, 'post') + SAFETY_RULES;
  const user = `Business: ${params.businessName}\nTrade: ${params.category}\nLocation: ${params.city}\nMonth: ${params.month}\nSeason: ${params.season}\nRecent posts to avoid:\n${params.recentPosts.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nWrite a new post.`;
  return generateWithValidation(system, user, 'post');
}

export async function generateReviewReply(params: {
  businessName: string; category: string; reviewerName: string;
  rating: number; comment: string;
  /** The shop's voice (lib/voice.ts). Optional, and never used for 1 to 3 stars: those get the fixed holding reply. */
  voice?: VoiceProfile | null;
}): Promise<string> {
  const tone = params.rating >= 4 ? 'warm, grateful, genuine' : 'professional, empathetic, constructive';
  const system = `You write review replies for UK tradespeople. British English. Sound real, not corporate. Be ${tone}. 2-3 sentences. Use reviewer's first name. Never defensive about negatives. Never admit fault, apologise for a specific failing, or offer a refund, discount, compensation or anything free. Never promise future action.` + voicePromptBlock(params.voice, 'reply') + SAFETY_RULES;
  const user = `Business: ${params.businessName}\nTrade: ${params.category}\nReviewer: ${params.reviewerName}\nRating: ${params.rating}/5\nComment: ${params.comment || '(no comment)'}\n\nWrite a reply.`;
  return generateWithValidation(system, user, 'reply');
}

export async function generateDescription(params: {
  businessName: string; category: string; city: string;
  existingDescription?: string; serviceArea?: string;
}): Promise<string> {
  const system = `You write Google Business Profile descriptions for UK tradespeople. British English, first person ("We're..."). Sound like a real tradesperson - friendly, professional, trustworthy. No marketing fluff. Include what they do, where they cover, reliability, soft call to action. 150-250 words. No hashtags, no emojis, no "Contact us today!" rubbish.` + SAFETY_RULES;
  const user = `Business: ${params.businessName}\nTrade: ${params.category}\nLocation: ${params.city}\n${params.serviceArea ? `Service area: ${params.serviceArea}` : ''}\n${params.existingDescription ? `Current (improve): ${params.existingDescription}` : 'None - write from scratch.'}\n\nWrite a description.`;
  return generateWithValidation(system, user, 'description', 500);
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
