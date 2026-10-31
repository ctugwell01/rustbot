'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection, PermissionFlagsBits } = require('discord.js');
const {
  GAMING_GUILD_ID,
  MOD_LOG_CHANNEL_ID,
  handleGamingMessage,
  scamLinkReason,
  hasMassMentionAttempt,
} = require('../gaming-moderation');

let counter = 30000;
const OWNER_ID = '111222333';

function makeArenaMessage(content, options = {}) {
  const replies = [], sends = [], deletions = [], timeouts = [], logs = [];
  const channels = new Collection();
  const channelList = options.missingSuggestions
    ? ['rules', 'tickets', 'bugs', 'server-status', 'announcements']
    : ['rules', 'tickets', 'bugs', 'server-status', 'announcements', 'suggestions'];
  for (let i = 0; i < channelList.length; i++) {
    const name = channelList[i];
    channels.set(String(i + 1), {
      id: String(i + 1),
      name,
      isTextBased: () => true,
      permissionsFor: () => ({ has: permission => permission === PermissionFlagsBits.ViewChannel && !options.hiddenSuggestions }),
    });
  }
  channels.set(MOD_LOG_CHANNEL_ID, {
    id: MOD_LOG_CHANNEL_ID,
    name: 'mod-logs',
    isTextBased: () => true,
    send: async data => logs.push(data),
  });

  const member = options.noMember ? null : {
    moderatable: options.moderatable !== false,
    permissions: { has: permission => Boolean(options.admin && permission === PermissionFlagsBits.Administrator) },
    roles: { cache: new Collection(options.moderator ? [['1', { name: 'mod' }]] : []) },
    timeout: async (duration, reason) => timeouts.push({ duration, reason }),
  };
  const message = {
    guildId: options.guildId || GAMING_GUILD_ID,
    guild: {
      ownerId: OWNER_ID,
      channels: { cache: channels },
      members: { fetch: async () => options.fetchedMember || null },
    },
    author: { bot: false, id: options.owner ? OWNER_ID : String(++counter), username: 'ArenaMember' },
    member,
    content,
    deletable: options.deletable !== false,
    channel: { id: 'test-channel', send: async data => sends.push(data) },
    mentions: { users: new Collection(), roles: new Collection(), members: new Collection() },
    delete: async () => deletions.push(content),
    reply: async data => replies.push(data),
  };
  return { message, replies, sends, deletions, timeouts, logs };
}

test('answers where suggestions are with the real clickable channel and no mass ping', async () => {
  const a = makeArenaMessage('is there a suggestion tab');
  assert.equal(await handleGamingMessage(a.message), true);
  assert.equal(a.replies.length, 1);
  assert.match(a.replies[0].content, /<#6>/);
  assert.match(a.replies[0].content, /share suggestions/i);
  assert.deepEqual(a.replies[0].allowedMentions, { parse: [], repliedUser: false });
  assert.equal(a.deletions.length, 0);
  assert.equal(a.timeouts.length, 0);
});

test('FAQ does not invent a suggestions channel when it is missing or private', async () => {
  const noChannel = makeArenaMessage('where is the suggestions channel?', { missingSuggestions: true });
  await handleGamingMessage(noChannel.message);
  assert.match(noChannel.replies[0].content, /couldn't find a visible channel/i);
  const privateChannel = makeArenaMessage('where are suggestions?', { hiddenSuggestions: true });
  await handleGamingMessage(privateChannel.message);
  assert.match(privateChannel.replies[0].content, /couldn't find a visible channel/i);
});

test('FAQ only responds to a question, and can answer leaving a gamemode', async () => {
  const statement = makeArenaMessage('I have a suggestion');
  assert.equal(await handleGamingMessage(statement.message), false);
  assert.equal(statement.replies.length, 0);
  const leave = makeArenaMessage('how do i leave this gamemode?');
  assert.equal(await handleGamingMessage(leave.message), true);
  assert.match(leave.replies[0].content, /\/leave/i);
});

test('long Discord invite promotions and discordapp.com links are always rejected', async () => {
  const longText = 'Hello everyone, I have a nice gaming group that you should check at some point. ' +
    'This community has lots of players and stuff. Just a Discord invite: discordapp.com/invite/J4u8eVE8Gc';
  assert.match(scamLinkReason(longText), /Discord invite spam/i);
  const a = makeArenaMessage(longText);
  assert.equal(await handleGamingMessage(a.message), true);
  assert.equal(a.deletions.length, 1);
  assert.equal(a.timeouts.length, 0);
  assert.equal(a.logs.length, 1);
  assert.match(a.logs[0].content, /Scam\/link protection/i);
  assert.deepEqual(a.sends[0].allowedMentions, { parse: [] });
});

test('moderator role cannot evade invite filtering; administrators and owner can', async () => {
  const moderator = makeArenaMessage('discord.gg/abc123', { moderator: true });
  await handleGamingMessage(moderator.message);
  assert.equal(moderator.deletions.length, 1);
  const admin = makeArenaMessage('discord.gg/abc123', { admin: true });
  assert.equal(await handleGamingMessage(admin.message), false);
  assert.equal(admin.deletions.length, 0);
  const owner = makeArenaMessage('discord.gg/abc123', { owner: true });
  assert.equal(await handleGamingMessage(owner.message), false);
  assert.equal(owner.deletions.length, 0);
});

test('unauthorised @everyone immediately removes and times out for five minutes', async () => {
  const a = makeArenaMessage('hey @everyone join now');
  assert.equal(hasMassMentionAttempt(a.message.content), true);
  assert.equal(await handleGamingMessage(a.message), true);
  assert.equal(a.deletions.length, 1);
  assert.equal(a.timeouts.length, 1);
  assert.equal(a.timeouts[0].duration, 5 * 60 * 1000);
  assert.match(a.sends[0].content, /only the owner and administrators/i);
  assert.match(a.sends[0].content, /timed out for 5 minutes/i);
  assert.deepEqual(a.sends[0].allowedMentions, { parse: [] });
  assert.match(a.logs[0].content, /Mass-mention protection/i);
  assert.match(a.logs[0].content, /5-minute timeout applied/i);
});

test('@here is protected too and a moderator role is not an admin exemption', async () => {
  const a = makeArenaMessage('@here look at this', { moderator: true });
  await handleGamingMessage(a.message);
  assert.equal(a.deletions.length, 1);
  assert.equal(a.timeouts.length, 1);
});

test('owner and actual administrators may post @everyone and @here', async () => {
  for (const options of [{ owner: true }, { admin: true }]) {
    const a = makeArenaMessage('hi @everyone', options);
    assert.equal(await handleGamingMessage(a.message), false);
    assert.equal(a.deletions.length, 0);
    assert.equal(a.timeouts.length, 0);
  }
});

test('mass-mention detection ignores email addresses and other server guilds', async () => {
  assert.equal(hasMassMentionAttempt('contact admin@everyone.example'), false);
  assert.equal(hasMassMentionAttempt('we have @everyone123 role'), false);
  const a = makeArenaMessage('@everyone ping', { guildId: '9999' });
  assert.equal(await handleGamingMessage(a.message), false);
  assert.equal(a.timeouts.length, 0);
  assert.equal(a.deletions.length, 0);
});

test('missing member data never results in a guessed admin permission or timeout', async () => {
  const a = makeArenaMessage('@everyone is broken', { noMember: true });
  assert.equal(await handleGamingMessage(a.message), true);
  assert.equal(a.deletions.length, 0);
  assert.equal(a.timeouts.length, 0);
});

test('missing timeout permission still removes the mass-mention attempt and logs it', async () => {
  const a = makeArenaMessage('@everyone ping', { moderatable: false });
  await handleGamingMessage(a.message);
  assert.equal(a.deletions.length, 1);
  assert.equal(a.timeouts.length, 0);
  assert.match(a.logs[0].content, /timeout unavailable/i);
});
