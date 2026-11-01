'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection, PermissionFlagsBits } = require('discord.js');
const {
  handleGamingMessage,
  GAMING_GUILD_ID,
  MOD_LOG_CHANNEL_ID,
  containsExternalLink,
  isPrivateSupportTicket,
} = require('../gaming-moderation');

let count = 50000;
const OWNER_ID = '111222333';

function mockMessage(content, options = {}) {
  const deletions = [], replies = [], notices = [], logs = [], timeouts = [];
  const channels = new Collection([
    ['1', { id: '1', name: 'tickets', isTextBased: () => true }],
    [MOD_LOG_CHANNEL_ID, { id: MOD_LOG_CHANNEL_ID, name: 'mod-logs',
      isTextBased: () => true, send: async payload => logs.push(payload) }],
  ]);
  const member = {
    permissions: { has: flag => Boolean(options.admin && flag === PermissionFlagsBits.Administrator) },
    roles: { cache: new Collection(options.moderator ? [['1', { name: 'moderator' }]] : []) },
    moderatable: true,
    timeout: async (duration, reason) => timeouts.push({ duration, reason }),
  };
  const everyone = { id: 'everyone-role' };
  const message = {
    guildId: options.guildId || GAMING_GUILD_ID,
    guild: { ownerId: OWNER_ID, channels: { cache: channels }, roles: { everyone } },
    author: { id: options.owner ? OWNER_ID : String(++count), username: 'TestUser', bot: false },
    member,
    content,
    deletable: options.deletable !== false,
    channel: {
      id: 'chat-channel',
      name: options.channelName || 'general',
      permissionsFor: role => ({ has: flag => flag === PermissionFlagsBits.ViewChannel && !options.privateChannel }),
      send: async payload => notices.push(payload),
    },
    mentions: { users: new Collection(), roles: new Collection(), members: new Collection() },
    delete: async () => deletions.push(content),
    reply: async payload => replies.push(payload),
  };
  return { message, deletions, replies, notices, logs, timeouts };
}

test('recognises normal Steam profiles and other common URL formats as links', () => {
  assert.equal(containsExternalLink('https://steamcommunity.com/profiles/76561199019159627'), true);
  assert.equal(containsExternalLink('steamcommunity.com/profiles/76561199019159627'), true);
  assert.equal(containsExternalLink('https://example.com'), true);
  assert.equal(containsExternalLink('www.example.org/support'), true);
  assert.equal(containsExternalLink('discord.com/channels/123/456'), true);
  assert.equal(containsExternalLink('hello world'), false);
  assert.equal(containsExternalLink('write to admin@example.com'), false);
  assert.equal(containsExternalLink('version 1.2.3'), false);
});

test('ordinary members posting Steam profiles in public chat are removed and logged', async () => {
  const a = mockMessage('https://steamcommunity.com/profiles/76561199019159627');
  assert.equal(await handleGamingMessage(a.message), true);
  assert.equal(a.deletions.length, 1);
  assert.equal(a.timeouts.length, 0);
  assert.equal(a.notices.length, 1);
  assert.match(a.notices[0].content, /external links are not allowed/i);
  assert.match(a.notices[0].content, /private ticket/i);
  assert.deepEqual(a.notices[0].allowedMentions, { parse: [] });
  assert.equal(a.logs.length, 1);
  assert.match(a.logs[0].content, /Public link protection/i);
  assert.match(a.logs[0].content, /no timeout or ban/i);
});

test('a moderator without Administrator permission cannot post public links', async () => {
  const a = mockMessage('https://example.net', { moderator: true });
  await handleGamingMessage(a.message);
  assert.equal(a.deletions.length, 1);
});

test('owner and Discord Administrators can post public links', async () => {
  for (const options of [{ admin: true }, { owner: true }]) {
    const a = mockMessage('https://steamcommunity.com/id/example', options);
    assert.equal(await handleGamingMessage(a.message), false);
    assert.equal(a.deletions.length, 0);
    assert.equal(a.timeouts.length, 0);
  }
});

test('valid private ticket allows Steam evidence links', async () => {
  const a = mockMessage('https://steamcommunity.com/profiles/76561199019159627', {
    channelName: 'ticket-player-report', privateChannel: true,
  });
  assert.equal(isPrivateSupportTicket(a.message), true);
  assert.equal(await handleGamingMessage(a.message), false);
  assert.equal(a.deletions.length, 0);
});

test('a public channel named ticket is not an exemption', async () => {
  const a = mockMessage('steamcommunity.com/profiles/76561199019159627', {
    channelName: 'ticket-player-report', privateChannel: false,
  });
  assert.equal(isPrivateSupportTicket(a.message), false);
  assert.equal(await handleGamingMessage(a.message), true);
  assert.equal(a.deletions.length, 1);
});

test('Discord invites remain blocked even inside a private ticket', async () => {
  const a = mockMessage('discordapp.com/invite/another-server', {
    channelName: 'ticket-reports', privateChannel: true,
  });
  assert.equal(await handleGamingMessage(a.message), true);
  assert.equal(a.deletions.length, 1);
  assert.match(a.logs[0].content, /Scam\/link protection/i);
});

test('other Discord servers are not moderated', async () => {
  const a = mockMessage('https://steamcommunity.com/profiles/123', { guildId: 'other-server' });
  assert.equal(await handleGamingMessage(a.message), false);
  assert.equal(a.deletions.length, 0);
});

test('cannot delete still logs unsuccessful deletion', async () => {
  const a = mockMessage('https://example.com', { deletable: false });
  assert.equal(await handleGamingMessage(a.message), true);
  assert.equal(a.deletions.length, 0);
  assert.equal(a.logs.length, 1);
  assert.match(a.logs[0].content, /Delete unavailable/i);
});
