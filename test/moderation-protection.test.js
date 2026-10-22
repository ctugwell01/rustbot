const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const discord = fs.readFileSync(path.join(__dirname, '..', 'discord.js'), 'utf8');
const kick = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');

test('Discord spam moderation explicitly excludes privileged users', () => {
  assert.match(discord, /if\s*\(\s*!isPrivileged\s*&&\s*SPAM_PATTERNS\.some\(/);
});

test('Kick raid detection is gated by trusted status', () => {
  const trustedStatus = kick.indexOf('const isVIP =');
  const raidGate = kick.indexOf('if (!isVIP) {\n    const isRaid = await checkForRaid(username, content);');
  const spamCheck = kick.indexOf('const promotion = isVIP ? null : promotionDetector.check');
  assert.ok(trustedStatus >= 0 && raidGate > trustedStatus && spamCheck > raidGate);
});

test('moderation OAuth secret is sourced from the environment', () => {
  assert.match(kick, /clientSecret:\s*process\.env\.KICK_MOD_CLIENT_SECRET/);
  assert.doesNotMatch(kick, /clientSecret:\s*['"][^'"]+['"]/);
});
