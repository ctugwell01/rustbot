'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const {
  GAMING_GUILD_ID,
  handleGamingMessage,
  isProtectedPing,
  isSeriousServerIssue,
  suggestedChannel,
} = require('./gaming-moderation');

let nextId = 10000;
function gamingMessage(text, options = {}) {
  const users = new Collection();
  const roles = new Collection();
  const members = new Collection();
  const ownerId = '123456789';
  if (options.mentionOwner !== false) users.set(ownerId, { id: ownerId, username: '5HeadNN' });
  if (options.roleOwner) roles.set('987654321', { id: '987654321', name: 'Owner' });

  const channelNames = ['rules', 'announcements', 'gamemode-changes', 'server-status', 'members-channel', 'suggestions', 'bugs'];
  const channels = new Collection(channelNames.map((name, i) => [String(i + 1), {
    id: String(i + 1),
    name,
    isTextBased: () => true,
  }]));
  const replies = [];
  const timeouts = [];
  const member = {
    moderatable: options.moderatable !== false,
    permissions: { has: () => Boolean(options.staff) },
    roles: { cache: new Collection() },
    timeout: async (length, reason) => timeouts.push({ length, reason }),
  };
  const message = {
    guildId: options.guildId || GAMING_GUILD_ID,
    guild: { ownerId, channels: { cache: channels } },
    author: { id: String(++nextId), bot: false, username: 'RegularMember' },
    member,
    content: text,
    mentions: { users, roles, members },
    reply: async payload => replies.push(payload),
  };
  return { message, replies, timeouts };
}

test('recognises a real 5HeadNN ping and @Owner role', () => {
  const user = gamingMessage('<@123456789> can you help?', { mentionOwner: true });
  assert.equal(isProtectedPing(user.message), true);
  const role = gamingMessage('<@&987654321> question', { mentionOwner: false, roleOwner: true });
  assert.equal(isProtectedPing(role.message), true);
});

test('does not treat a reply metadata mention as a ping', () => {
  const { message } = gamingMessage('Thanks for the help');
  assert.equal(isProtectedPing(message), false);
});

test('allows genuine server incidents to ping the owner', async () => {
  assert.equal(isSeriousServerIssue('Server is down again!'), true);
  assert.equal(isSeriousServerIssue("Can't connect to the Rust server"), true);
  assert.equal(isSeriousServerIssue('What are the server rules?'), false);
  const { message, replies, timeouts } = gamingMessage('<@123456789> server is offline');
  assert.equal(await handleGamingMessage(message), true);
  assert.equal(replies.length, 0);
  assert.equal(timeouts.length, 0);
});

test('routes routine topics to the screenshot channels', () => {
  assert.equal(suggestedChannel('I found a bug'), 'bugs');
  assert.equal(suggestedChannel('I have a suggestion'), 'suggestions');
  assert.equal(suggestedChannel('when does the gamemode change?'), 'gamemode-changes');
  assert.equal(suggestedChannel('where do I find the server status?'), 'server-status');
  assert.equal(suggestedChannel('where are the rules?'), 'rules');
  assert.equal(suggestedChannel('any news announcements?'), 'announcements');
  assert.equal(suggestedChannel('hello owner can you help me'), 'members-channel');
});

test('first routine ping gets a channel link, no timeout and no notified mentions', async () => {
  const { message, replies, timeouts } = gamingMessage('<@123456789> I found a bug');
  assert.equal(await handleGamingMessage(message), true);
  assert.equal(timeouts.length, 0);
  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /<#7>/);
  assert.deepEqual(replies[0].allowedMentions, { parse: [], repliedUser: false });
});

test('staff are exempt from ping rules', async () => {
  const { message, replies } = gamingMessage('<@123456789> Need help', { staff: true });
  assert.equal(await handleGamingMessage(message), true);
  assert.equal(replies.length, 0);
});

test('three repeated routine pings cause a five-minute timeout but never a ban', async () => {
  const { message, replies, timeouts } = gamingMessage('<@123456789> general question');
  await handleGamingMessage(message);
  await handleGamingMessage(message);
  await handleGamingMessage(message);
  assert.equal(replies.length, 3);
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].length, 5 * 60 * 1000);
  assert.match(replies[2].content, /timed out for 5 minutes/i);
});

test('does not moderate other Discord servers', async () => {
  const { message, replies } = gamingMessage('<@123456789> help', { guildId: '1088905913550778380' });
  assert.equal(await handleGamingMessage(message), false);
  assert.equal(replies.length, 0);
});
