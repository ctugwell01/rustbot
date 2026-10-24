'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const {
  GAMING_GUILD_ID,
  MOD_LOG_CHANNEL_ID,
  handleGamingMessage,
  isProtectedPing,
  isSeriousServerIssue,
  isBanAppeal,
  isPlayerReport,
  scamLinkReason,
  countStaffMentions,
  ticketChannelLink,
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
  if (options.roleStaff) roles.set('555555555', { id: '555555555', name: 'Staff' });

  const channelNames = ['rules', 'announcements', 'gamemode-changes', 'server-status', 'members-channel', 'suggestions', 'bugs', 'tickets'];
  const channels = new Collection(channelNames.map((name, i) => [String(i + 1), {
    id: String(i + 1),
    name,
    isTextBased: () => true,
  }]));
  const replies = [];
  const sends = [];
  const modLogs = [];
  if (options.modLogAvailable !== false) {
    channels.set(MOD_LOG_CHANNEL_ID, {
      id: MOD_LOG_CHANNEL_ID,
      name: 'mod-logs',
      isTextBased: () => true,
      send: async payload => modLogs.push(payload),
    });
  }
  const deletions = [];
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
    deletable: options.deletable !== false,
    channel: { id: 'source-channel', send: async payload => sends.push(payload) },
    mentions: { users, roles, members },
    delete: async () => deletions.push(text),
    reply: async payload => replies.push(payload),
  };
  return { message, replies, sends, modLogs, deletions, timeouts };
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
  const { message, replies, sends, deletions, timeouts } = gamingMessage('<@123456789> server is offline');
  assert.equal(await handleGamingMessage(message), true);
  assert.equal(replies.length, 0);
  assert.equal(sends.length, 0);
  assert.equal(deletions.length, 0);
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

test('first routine ping is deleted then redirected with no notified mentions', async () => {
  const { message, sends, modLogs, deletions, timeouts } = gamingMessage('<@123456789> I found a bug');
  assert.equal(await handleGamingMessage(message), true);
  assert.equal(timeouts.length, 0);
  assert.equal(deletions.length, 1);
  assert.equal(sends.length, 1);
  assert.match(sends[0].content, /<#7>/);
  assert.deepEqual(sends[0].allowedMentions, { parse: [] });
  assert.equal(modLogs.length, 1);
  assert.match(modLogs[0].content, /Owner-ping moderation/i);
  assert.match(modLogs[0].content, /Redirect.*<#7>/s);
  assert.match(modLogs[0].content, /Warning 1\/3/);
  assert.deepEqual(modLogs[0].allowedMentions, { parse: [] });
});

test('staff are exempt from ping deletion and redirects', async () => {
  const { message, replies, sends, modLogs, deletions } = gamingMessage('<@123456789> Need help', { staff: true });
  assert.equal(await handleGamingMessage(message), true);
  assert.equal(replies.length, 0);
  assert.equal(sends.length, 0);
  assert.equal(modLogs.length, 0);
  assert.equal(deletions.length, 0);
});

test('three repeated routine pings are deleted and cause a five-minute timeout but never a ban', async () => {
  const { message, sends, modLogs, deletions, timeouts } = gamingMessage('<@123456789> general question');
  await handleGamingMessage(message);
  await handleGamingMessage(message);
  await handleGamingMessage(message);
  assert.equal(sends.length, 3);
  assert.equal(modLogs.length, 3);
  assert.equal(deletions.length, 3);
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].length, 5 * 60 * 1000);
  assert.match(sends[2].content, /timed out for 5 minutes/i);
  assert.match(modLogs[2].content, /5-minute timeout applied/i);
});

test('does not moderate other Discord servers', async () => {
  const { message, replies } = gamingMessage('<@123456789> help', { guildId: '1088905913550778380' });
  assert.equal(await handleGamingMessage(message), false);
  assert.equal(replies.length, 0);
});

test('SheepSync diagnostic responds in gaming server even for staff', async () => {
  const { message, replies, timeouts } = gamingMessage('!sheepsync', { staff: true, mentionOwner: false });
  assert.equal(await handleGamingMessage(message), true);
  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /online in this gaming Discord/i);
  assert.equal(timeouts.length, 0);
});

test('routine ping still redirects if SheepSync lacks delete permission', async () => {
  const { message, sends, deletions } = gamingMessage('<@123456789> where are the rules?', { deletable: false });
  assert.equal(await handleGamingMessage(message), true);
  assert.equal(deletions.length, 0);
  assert.equal(sends.length, 1);
  assert.match(sends[0].content, /<#1>/);
});

test('mod-log failure never blocks deletion or redirect', async () => {
  const { message, sends, modLogs, deletions } = gamingMessage('<@123456789> what are the rules?', { modLogAvailable: false });
  assert.equal(await handleGamingMessage(message), true);
  assert.equal(deletions.length, 1);
  assert.equal(sends.length, 1);
  assert.equal(modLogs.length, 0);
  assert.match(sends[0].content, /<#1>/);
});

test('recognises common ban-appeal wording', () => {
  assert.equal(isBanAppeal('why am i banned?'), true);
  assert.equal(isBanAppeal('I got banned for no reason'), true);
  assert.equal(isBanAppeal('can I get unbanned please'), true);
  assert.equal(isBanAppeal('where are the rules?'), false);
});

test('standalone ban question redirects to tickets without deletion or timeout', async () => {
  const { message, replies, sends, deletions, timeouts } = gamingMessage('why am i banned?', { mentionOwner: false });
  assert.equal(await handleGamingMessage(message), true);
  assert.equal(deletions.length, 0);
  assert.equal(timeouts.length, 0);
  assert.equal(sends.length, 0);
  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /<#8>/);
  assert.match(replies[0].content, /open a ticket/i);
});

test('ban question with owner ping deletes the ping and redirects to tickets without timeout', async () => {
  const { message, replies, sends, deletions, timeouts } = gamingMessage('<@123456789> why am i banned?');
  assert.equal(await handleGamingMessage(message), true);
  assert.equal(deletions.length, 1);
  assert.equal(timeouts.length, 0);
  assert.equal(replies.length, 0);
  assert.equal(sends.length, 1);
  assert.match(sends[0].content, /<#8>/);
  assert.match(sends[0].content, /staff team can review it/i);
});

test('ticket channel lookup falls back cleanly', () => {
  const guild = { channels: { cache: new Collection() } };
  assert.equal(ticketChannelLink(guild), '#ticket');
});

test('recognises cheating/player/admin-abuse reports', () => {
  assert.equal(isPlayerReport('this guy is cheating'), true);
  assert.equal(isPlayerReport('I need to report a player'), true);
  assert.equal(isPlayerReport('admin abuse'), true);
  assert.equal(isPlayerReport('where are the rules?'), false);
});

test('player report redirects to ticket with Steam ID and clip instructions', async () => {
  const { message, replies, sends, deletions, timeouts, modLogs } = gamingMessage('this guy is cheating', { mentionOwner: false });
  assert.equal(await handleGamingMessage(message), true);
  assert.equal(deletions.length, 0);
  assert.equal(timeouts.length, 0);
  assert.equal(sends.length, 0);
  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /<#8>/);
  assert.match(replies[0].content, /Steam ID/i);
  assert.match(replies[0].content, /clip\/video if possible/i);
  assert.equal(modLogs.length, 1);
  assert.match(modLogs[0].content, /Player\/report redirect/i);
});

test('player report with owner ping removes the ping but never times out', async () => {
  const { message, replies, sends, deletions, timeouts } = gamingMessage('<@123456789> report player this guy is cheating');
  assert.equal(await handleGamingMessage(message), true);
  assert.equal(deletions.length, 1);
  assert.equal(timeouts.length, 0);
  assert.equal(replies.length, 0);
  assert.equal(sends.length, 1);
  assert.match(sends[0].content, /Steam ID/i);
});

test('detects obvious invite, fake Nitro, fake Steam and shortened links', () => {
  assert.match(scamLinkReason('join my server https://discord.gg/abcdef'), /Discord invite spam/i);
  assert.match(scamLinkReason('free nitro https://discord-nitro-gift.example/claim'), /fake Discord\/Nitro/i);
  assert.match(scamLinkReason('steam login https://steamcommunity-login.example/signin'), /fake Steam/i);
  assert.match(scamLinkReason('click https://bit.ly/abc123'), /shortened URL/i);
  assert.equal(scamLinkReason('profile https://steamcommunity.com/id/example'), null);
  assert.equal(scamLinkReason('gift https://discord.gift/example'), null);
});

test('scam link is deleted and logged without a ban or timeout', async () => {
  const { message, sends, deletions, timeouts, modLogs } = gamingMessage('free nitro https://discord-nitro-gift.example/claim', { mentionOwner: false });
  assert.equal(await handleGamingMessage(message), true);
  assert.equal(deletions.length, 1);
  assert.equal(timeouts.length, 0);
  assert.equal(sends.length, 1);
  assert.match(sends[0].content, /suspicious\/invite links/i);
  assert.equal(modLogs.length, 1);
  assert.match(modLogs[0].content, /Scam\/link protection/i);
});

test('two staff or owner mentions in one message cause immediate five-minute timeout', async () => {
  const { message, sends, deletions, timeouts, modLogs } = gamingMessage('<@123456789> <@123456789> stop ignoring me');
  assert.equal(countStaffMentions(message), 2);
  assert.equal(await handleGamingMessage(message), true);
  assert.equal(deletions.length, 1);
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].length, 5 * 60 * 1000);
  assert.equal(sends.length, 1);
  assert.match(sends[0].content, /timed out for 5 minutes/i);
  assert.equal(modLogs.length, 1);
  assert.match(modLogs[0].content, /Mention-spam protection/i);
});

test('three separate staff-role tagging messages cause timeout on the third', async () => {
  const { message, sends, deletions, timeouts, modLogs } = gamingMessage('<@&555555555> help', { mentionOwner: false, roleStaff: true });
  assert.equal(countStaffMentions(message), 1);
  assert.equal(await handleGamingMessage(message), false);
  assert.equal(await handleGamingMessage(message), false);
  assert.equal(await handleGamingMessage(message), true);
  assert.equal(deletions.length, 1);
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].length, 5 * 60 * 1000);
  assert.equal(sends.length, 1);
  assert.equal(modLogs.length, 1);
});

test('single owner ping about real outage is exempt from mention-spam timeout', async () => {
  const { message, deletions, timeouts } = gamingMessage('<@123456789> server is down');
  assert.equal(await handleGamingMessage(message), true);
  assert.equal(deletions.length, 0);
  assert.equal(timeouts.length, 0);
});
