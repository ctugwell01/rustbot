'use strict';

// High-confidence rules. No URL visits, DM access, or attachment-content scanning.
const DANGEROUS_EXTENSIONS = new Set([
  'exe', 'scr', 'bat', 'cmd', 'com', 'pif', 'msi', 'msp',
  'ps1', 'psm1', 'vbs', 'vbe', 'wsf', 'wsh', 'hta', 'jar',
  'apk', 'lnk', 'reg', 'sh',
]);

function attachmentNames(attachments) {
  if (!attachments) return [];
  let files = [];
  if (typeof attachments.values === 'function') files = Array.from(attachments.values());
  else if (Array.isArray(attachments)) files = attachments;
  return files.map(file => String(file?.name || file?.filename || '').trim()).filter(Boolean);
}

function detectScamContent(content, attachments) {
  const text = String(content || '');
  for (const filename of attachmentNames(attachments)) {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (DANGEROUS_EXTENSIONS.has(ext)) {
      return { reason: 'Potentially dangerous file attachment (.' + ext + ')', severity: 'high' };
    }
  }

  const credentials = /\b(?:passwords?|passcodes?|two.factor|2fa|mfa|otp|one.time (?:password|code)|login codes?|verification codes?|recovery codes?|backup codes?|steam guard codes?)\b/i;
  const solicitCodes = /\b(?:dm|send|share|give|provide|message|forward)\s+(?:me|us|staff|support)\b/i;
  const reversed = /\b(?:dm|send|share|give|provide|message|forward)\s+me\s+(?:your|the)\s+(?:steam guard|discord|steam|account)\s+(?:code|password|recovery|2fa)\b/i;
  if ((credentials.test(text) && solicitCodes.test(text)) || reversed.test(text)) {
    return { reason: 'Request for account credentials or security codes', severity: 'high' };
  }

  if (/\b(?:scan|use|open)\b.{0,35}\bqr\s*code\b.{0,70}\b(?:verify|login|log in|authenticate|discord|steam|account)\b/i.test(text) ||
      /\b(?:verify|authenticate|login|log in)\b.{0,60}\b(?:discord|steam|account)\b.{0,45}\bqr\s*code\b/i.test(text)) {
    return { reason: 'Unsolicited account-verification QR-code request', severity: 'high' };
  }

  const fakeGift = /\b(?:free\s+(?:discord\s+)?nitro|free\s+(?:steam\s+)?skins?|steam\s+(?:wallet|gift\s+card)|giveaway|gift\s+card|prize|reward)\b/i.test(text);
  const solicit = /\b(?:dm\s+(?:me|us)|message\s+(?:me|us)|click\s+(?:here|now)|claim\s+(?:your|now|it)|verify\s+(?:your|to)|login\s+to|sign\s+in\s+to|scan\s+(?:the|this)\s+qr)\b/i.test(text);
  if (fakeGift && solicit) {
    return { reason: 'Prize/giveaway promotion requesting account action', severity: 'high' };
  }

  const crypto = /\b(?:crypto|bitcoin|btc|eth|investment|trading|forex)\b/i.test(text);
  const guaranteed = /\b(?:guaranteed (?:profit|returns?|money)|double your (?:money|coins)|100% (?:profit|returns?)|risk.free returns?)\b/i.test(text);
  if (crypto && guaranteed && /\b(?:dm|message|send|deposit|invest|join|claim)\b/i.test(text)) {
    return { reason: 'Guaranteed-return financial solicitation', severity: 'high' };
  }

  return null;
}

const offenseHistory = new Map();
const OFFENSE_WINDOW_MS = 10 * 60 * 1000;
const OFFENSE_LIMIT = 3;
const MAX_TRACKED_MEMBERS = 2000;

function recordBlockedPost(guildId, memberId, now = Date.now()) {
  const key = String(guildId) + ':' + String(memberId);
  for (const [id, entries] of offenseHistory) {
    if (!entries.some(ts => now - ts < OFFENSE_WINDOW_MS)) offenseHistory.delete(id);
  }
  const old = offenseHistory.get(key) || [];
  const updated = old.filter(ts => now - ts < OFFENSE_WINDOW_MS);
  updated.push(now);
  offenseHistory.delete(key);
  offenseHistory.set(key, updated);
  while (offenseHistory.size > MAX_TRACKED_MEMBERS) {
    offenseHistory.delete(offenseHistory.keys().next().value);
  }
  return { count: updated.length, repeated: updated.length >= OFFENSE_LIMIT };
}

function defangEvidence(value) {
  return String(value || '')
    .replace(/@/g, '@\u200b')
    .replace(/\./g, '[.]')
    .replace(/https?:\/\//gi, scheme => scheme.toLowerCase().startsWith('https') ? 'hxxps://' : 'hxxp://')
    .replace(/\x60/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500) || '(empty message)';
}

module.exports = { attachmentNames, detectScamContent, recordBlockedPost, defangEvidence };
