'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection, PermissionFlagsBits } = require('discord.js');
const {
  handleGamingMessage, GAMING_GUILD_ID, MOD_LOG_CHANNEL_ID,
} = require('../gaming-moderation');
const {
  detectScamContent, recordBlockedPost, defangEvidence,
} = require('../arena-scam-defense');

let nextId = 100000;
const OWNER = '550000000';

function createMessage(content, options = {}) {
  const deletions = [], timeouts = [], notices = [], logs = [], replies = [];
  const member = {
    moderatable: options.moderatable !== false,
    permissions: { has: flag => Boolean(options.admin && flag === PermissionFlagsBits.Administrator) },
    roles: { cache: new Collection() },
    timeout: async (ms, reason) => timeouts.push({ ms, reason }),
  };
  const guild = {
    ownerId: OWNER,
    roles: { everyone: { id: 'all' } },
    channels: { cache: new Collection([
      ['1', { id: '1', name: 'tickets', isTextBased: () => true }],
      [MOD_LOG_CHANNEL_ID, { id: MOD_LOG_CHANNEL_ID, isTextBased: () => true, name: 'mod-logs',
        send: async item => logs.push(item) }],
    ]) },
  };
  const message = {
    guildId: GAMING_GUILD_ID,
    guild,
    author: { id: options.owner ? OWNER : String(++nextId), username: 'TestMember', bot: false },
    member, content,
    attachments: new Collection((options.files || []).map((name, index) => [String(index), { name }])),
    mentions: { users: new Collection(), roles: new Collection(), members: new Collection() },
    deletable: options.deletable !== false,
    delete: async () => deletions.push(content),
    channel: {
      id: 'general',
      name: options.privateTicket ? 'ticket-evidence' : 'general',
      permissionsFor: () => ({ has: flag => flag === PermissionFlagsBits.ViewChannel && !options.privateTicket }),
      send: async item => notices.push(item),
    },
    reply: async item => replies.push(item),
  };
  return { message, deletions, timeouts, notices, logs, replies };
}

test('high-confidence scams are detected without relying on a link', () => {
  assert.match(detectScamContent('DM me your Steam Guard code').reason, /credentials/i);
  assert.match(detectScamContent('Scan this QR code to verify your Discord account').reason, /QR-code/i);
  assert.match(detectScamContent('Official Steam support: send me your password').reason, /credentials/i);
  assert.match(detectScamContent('Free Nitro! DM me to claim your reward').reason, /giveaway/i);
  assert.match(detectScamContent('Guaranteed crypto profit, DM me to invest').reason, /financial solicitation/i);
});

test('scam reports and harmless chat avoid automatic false positives', () => {
  assert.equal(detectScamContent('Warning: someone said DM me your Steam Guard code'), null);
  assert.equal(detectScamContent('Is this a scam? Free nitro DM me to claim'), null);
  assert.equal(detectScamContent('how do I enable Steam Guard 2FA?'), null);
  assert.equal(detectScamContent('where can I report a player?'), null);
  assert.equal(detectScamContent('Just joined the free skins game mode'), null);
});

test('potentially dangerous scripts/executables are blocked; normal images and videos are fine', () => {
  assert.match(detectScamContent('', [{ name: 'rust-cheats.exe' }]).reason, /dangerous file/i);
  assert.match(detectScamContent('', new Collection([['1', { name: 'installer.ps1' }]])).reason, /dangerous file/i);
  assert.match(detectScamContent('', [{ name: 'image.JAR' }]).reason, /dangerous file/i);
  assert.equal(detectScamContent('', [{ name: 'rust-cheat-report.png' }]), null);
  assert.equal(detectScamContent('', [{ name: 'evidence.mp4' }]), null);
});

test('credential-theft attempt auto-deletes, timeouts for 10 minutes and logs safely', async () => {
  const a = createMessage('DM me your Steam Guard code');
  assert.equal(await handleGamingMessage(a.message), true);
  assert.equal(a.deletions.length, 1);
  assert.equal(a.timeouts.length, 1);
  assert.equal(a.timeouts[0].ms, 10 * 60 * 1000);
  assert.equal(a.notices.length, 1);
  assert.match(a.notices[0].content, /timed out for 10 minutes/i);
  assert.deepEqual(a.notices[0].allowedMentions, { parse: [] });
  assert.equal(a.logs.length, 1);
  assert.match(a.logs[0].content, /Scam\/phishing protection/i);
  assert.match(a.logs[0].content, /10-minute timeout applied/i);
});

test('unsafe attachment is removed and offender timed out, regardless of text', async () => {
  const a = createMessage('check this out', { files: ['cool-plugin.cmd'] });
  await handleGamingMessage(a.message);
  assert.equal(a.deletions.length, 1);
  assert.equal(a.timeouts.length, 1);
});

test('quoted scam text can appear as private ticket evidence but executable still blocked', async () => {
  const report = createMessage('DM me your Steam Guard code', { privateTicket: true });
  assert.equal(await handleGamingMessage(report.message), false);
  assert.equal(report.timeouts.length, 0);
  const attachment = createMessage('here is the installer', { privateTicket: true, files: ['malware.exe'] });
  assert.equal(await handleGamingMessage(attachment.message), true);
  assert.equal(attachment.deletions.length, 1);
  assert.equal(attachment.timeouts.length, 0);
});

test('normal giveaway messages are removed without first-offence timeout', async () => {
  const a = createMessage('Free Nitro! DM me to claim your reward');
  assert.equal(await handleGamingMessage(a.message), true);
  assert.equal(a.deletions.length, 1);
  assert.equal(a.timeouts.length, 0);
});

test('three ordinary links within ten minutes escalate to a five-minute timeout', async () => {
  const a = createMessage('https://steamcommunity.com/profiles/76561199019159627');
  await handleGamingMessage(a.message);
  await handleGamingMessage(a.message);
  await handleGamingMessage(a.message);
  assert.equal(a.deletions.length, 3);
  assert.equal(a.timeouts.length, 1);
  assert.equal(a.timeouts[0].ms, 5 * 60 * 1000);
  assert.match(a.logs[2].content, /blocked posts in 10 minutes: 3/i);
  assert.match(a.logs[2].content, /5-minute timeout applied/i);
});

test('owner and admins remain exempt from automatic link and scam text moderation', async () => {
  for (const options of [{ admin: true }, { owner: true }]) {
    const a = createMessage('DM me your Steam Guard code', options);
    assert.equal(await handleGamingMessage(a.message), false);
    assert.equal(a.deletions.length, 0);
    assert.equal(a.timeouts.length, 0);
  }
});

test('mod logs defang clickable links, user mentions and markdown backticks', () => {
  const safe = defangEvidence('Visit https://fake-steam.example/claim @everyone now');
  assert.match(safe, /hxxps:\/\//);
  assert.match(safe, /fake-steam\[\.\]example/i);
  assert.doesNotMatch(safe, /https:\/\//);
  assert.doesNotMatch(safe, /@everyone/);
});

test('offence counter expires entries after ten minutes', () => {
  const one = recordBlockedPost('test-expiry', 'user-X', 1000000000);
  const two = recordBlockedPost('test-expiry', 'user-X', 1000000100);
  const three = recordBlockedPost('test-expiry', 'user-X', 1000000200);
  const after = recordBlockedPost('test-expiry', 'user-X', 1000000000 + 11 * 60 * 1000);
  assert.equal(one.count, 1);
  assert.equal(two.count, 2);
  assert.equal(three.repeated, true);
  assert.equal(after.count, 1);
});
