'use strict';

// Detect unsolicited growth/promotional pitches using combinations of intent signals
// rather than maintaining a blacklist of scammer usernames or exact sales scripts.
const WINDOW_MS = 2 * 60 * 1000;
const MAX_USERS = 2000;
const MAX_MESSAGES = 5;
const SPAM_SCORE = 4;

function normalize(message) {
  return String(message || '')
    .normalize('NFKC')
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function getSignals(message) {
  const text = normalize(message);
  const offer = /\b(?:i|we)\s+(?:can|could|will|would|wanna|want to|would love to|am able to|can help)\b.{0,50}\b(?:share|promote|advertise|feature|market|boost|grow)\b.{0,65}\b(?:your|ur)\s+(?:stream|channel|broadcast)\b/.test(text);
  const strongPromotion = offer && /\b(?:promote|advertise|feature|market|boost|grow)\b/.test(text);
  const community = /\b(?:kick|streamer|streaming|creator|gaming|discord|support)\s+(?:(?:large|big|private|active|online)\s+)?(?:community|group|network|server|hub)\b/.test(text);
  const growth = /\b(?:help|boost|increase|grow|get|gain|reach|bring|deliver|attract)\b.{0,45}\b(?:you|your|ur)\b.{0,85}\b(?:followers?|viewers?|subscribers?|audience|channel)\b/.test(text) ||
    /\b(?:get|gain|boost|buy|increase)\b.{0,35}\b(?:followers?|viewers?|subscribers?)\b/.test(text);
  const targets = new Set([...text.matchAll(/\b\d[\d,.]*(?:k|m)?\s*(followers?|viewers?|subscribers?|subs?)\b/g)].map(match => match[1].replace(/s$/, '')));
  const earnings = /\b(?:earn|make|generate|receive|profit)\b.{0,60}(?:[$£€]\s*\d[\d,.]*|\d[\d,.]*\s*(?:dollars?|usd|gbp|pounds?))/.test(text) &&
    /\b(?:stream|streaming|channel|broadcast|live|per day|daily)\b/.test(text);
  // 'Add me up on Discord', 'DM me on Discord', and similar contact requests.
  const directContact = /\b(?:add|dm|message|contact|hit|reach|find|ping)\s+(?:me|us)\s+(?:(?:up|back)\s+)?(?:(?:on|via|at|through)\s+)?(?:my\s+)?(?:discord|telegram|whatsapp|instagram|tg)\b/.test(text);
  const socialPlatform = /\b(?:discord|telegram|whatsapp|instagram|tg)\b/.test(text);
  const askToChat = /\b(?:let's|lets)\s+(?:chat|connect|talk)\b|\b(?:dm|message|contact)\s+me\b/.test(text);
  return { offer, strongPromotion, community, growth, targets, earnings, directContact, socialPlatform, askToChat };
}

function scoreMessages(messages) {
  const signals = messages.map(getSignals);
  const has = name => signals.some(s => s[name]);
  const targets = new Set(signals.flatMap(s => [...s.targets]));
  let score = 0;
  const reasons = [];
  if (has('offer')) { score += 3; reasons.push('offering stream promotion'); }
  if (has('offer') && has('strongPromotion')) score += 1;
  if (has('offer') && has('community')) { score += 2; reasons.push('community placement pitch'); }
  if (has('growth')) { score += 2; reasons.push('growth pitch'); }
  if (has('growth') && targets.size > 0) {
    score += Math.min(2, targets.size);
    reasons.push('promised audience numbers');
  }
  if (has('earnings')) { score += 2; reasons.push('stream earnings claim'); }
  if (has('directContact')) { score += 4; reasons.push('off-platform contact request'); }
  else if (has('socialPlatform') && has('askToChat') && (has('growth') || has('offer'))) {
    score += 2;
    reasons.push('off-platform sales follow-up');
  }
  return { isSpam: score >= SPAM_SCORE, score, reason: reasons.join(', ') };
}

function createPromotionDetector({ windowMs = WINDOW_MS, maxUsers = MAX_USERS, now = Date.now } = {}) {
  const recentByUser = new Map();
  return {
    check(username, message) {
      const key = String(username || '').toLowerCase();
      if (!key || !String(message || '').trim()) return { isSpam: false, score: 0, reason: '' };
      const time = now();
      const previous = recentByUser.get(key) || [];
      const recent = previous.filter(item => time - item.time <= windowMs);
      recent.push({ time, text: message });
      if (recent.length > MAX_MESSAGES) recent.splice(0, recent.length - MAX_MESSAGES);
      // Map insertion-order eviction bounds memory even if new usernames never return.
      recentByUser.delete(key);
      recentByUser.set(key, recent);
      if (recentByUser.size > maxUsers) recentByUser.delete(recentByUser.keys().next().value);
      return scoreMessages(recent.map(item => item.text));
    },
  };
}

module.exports = { createPromotionDetector, scoreMessages };
