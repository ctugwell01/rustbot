'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const {
  ARENA_GUILD_ID,
  triggerFromText,
  getArenaChatTrigger,
  cleanReply,
  buildMessages,
  handleArenaChat,
} = require('../arena-chat');

const BOT_ID = '1489222602714120272';
let sequence = 100000;

function makeMessage(content, options = {}) {
  const sent = [];
  const typing = [];
  const id = options.authorId || String(++sequence);
  const message = {
    guildId: options.guildId || ARENA_GUILD_ID,
    channelId: options.channelId || 'chat-channel',
    author: { id, bot: Boolean(options.bot) },
    content,
    mentions: { users: new Collection(options.mentioned ? [[BOT_ID, { id: BOT_ID }]] : []) },
    channel: { id: options.channelId || 'chat-channel', sendTyping: async () => typing.push(true) },
    reference: options.reference ? { messageId: 'last-reply' } : null,
    fetchReference: async () => ({ author: { id: options.referenceAuthor || BOT_ID } }),
    reply: async payload => sent.push(payload),
  };
  return { message, sent, typing };
}

function fakeGroq(text = 'Oi, ask away mate!') {
  const calls = [];
  const handler = async (url, payload) => {
    calls.push({ url, payload: JSON.parse(payload.body), authorization: payload.headers.Authorization });
    return { ok: true, json: async () => ({ choices: [{ message: { content: text } }] }) };
  };
  return { calls, handler };
}

test('addressing SheepSync and chat commands are explicit triggers', () => {
  assert.deepEqual(triggerFromText('!ask how do I raid?', BOT_ID, false), { kind: 'command', question: 'how do I raid?' });
  assert.deepEqual(triggerFromText('!ai what is Rust?', BOT_ID, false), { kind: 'command', question: 'what is Rust?' });
  assert.deepEqual(triggerFromText('hey SheepSync, how are you?', BOT_ID, false), { kind: 'address', question: 'how are you?' });
  assert.deepEqual(triggerFromText('SheepSync what do you think?', BOT_ID, false), { kind: 'address', question: 'what do you think?' });
  assert.deepEqual(triggerFromText('<@' + BOT_ID + '> hi', BOT_ID, true), { kind: 'mention', question: 'hi' });
  assert.equal(triggerFromText('normal server conversation', BOT_ID, false), null);
  assert.equal(triggerFromText('This is about sheep synchronization', BOT_ID, false), null);
});

test('replies to the actual bot are recognized, but replies to other members are not', async () => {
  const yes = makeMessage('that makes sense', { reference: true });
  assert.deepEqual(await getArenaChatTrigger(yes.message, BOT_ID), { kind: 'reply', question: 'that makes sense' });
  const no = makeMessage('ok', { reference: true, referenceAuthor: 'someone-else' });
  assert.equal(await getArenaChatTrigger(no.message, BOT_ID), null);
});

test('other servers and bot-authored messages are ignored', async () => {
  const other = makeMessage('!ask hello', { guildId: '1088905913550778380' });
  assert.equal(await handleArenaChat(other.message, BOT_ID, { apiKey: 'fake', fetchImpl: fakeGroq().handler }), false);
  assert.equal(other.sent.length, 0);
  const bot = makeMessage('!ask hello', { bot: true });
  assert.equal(await handleArenaChat(bot.message, BOT_ID, { apiKey: 'fake', fetchImpl: fakeGroq().handler }), false);
  assert.equal(bot.sent.length, 0);
});

test('a member can ask with !ask and gets safe no-ping response', async () => {
  const a = makeMessage('!ask how are you?');
  const groq = fakeGroq('All good mate! Try the Rust arena.');
  assert.equal(await handleArenaChat(a.message, BOT_ID, { apiKey: 'unit-test', fetchImpl: groq.handler }), true);
  assert.equal(a.sent.length, 1);
  assert.equal(a.sent[0].content, 'All good mate! Try the Rust arena.');
  assert.deepEqual(a.sent[0].allowedMentions, { parse: [], repliedUser: false });
  assert.equal(groq.calls.length, 1);
  assert.equal(groq.calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(groq.calls[0].authorization, 'Bearer unit-test');
  assert.equal(groq.calls[0].payload.model, 'openai/gpt-oss-120b');
  assert.equal(groq.calls[0].payload.messages[0].role, 'system');
  assert.equal(groq.calls[0].payload.messages.at(-1).content, 'how are you?');
  assert.equal(a.typing.length, 1);
});

test('pings cannot be sent by an AI response', () => {
  const text = cleanReply('Hey @everyone <@1234> <@&5678>! @here');
  assert.ok(!text.includes('@everyone'));
  assert.ok(!text.includes('@here'));
  assert.ok(!text.includes('<@1234>'));
  assert.ok(!text.includes('<@&5678>'));
});

test('AI replies cannot repost external links or mention Discord users', () => {
  const text = cleanReply('Visit https://fake-steam.example and discord.gg/bad123 <@!1234>');
  assert.match(text, /link omitted/i);
  assert.doesNotMatch(text, /https:\/\//i);
  assert.doesNotMatch(text, /discord\.gg\//i);
  assert.doesNotMatch(text, /<@/);
});

test('short help replies do not require an API call', async () => {
  const message = makeMessage('!ask');
  assert.equal(await handleArenaChat(message.message, BOT_ID, { apiKey: null, fetchImpl: () => { throw Error('should not call API'); } }), true);
  assert.match(message.sent[0].content, /!ask/i);
});

test('unconfigured and failed provider responses give a helpful fallback', async () => {
  const missing = makeMessage('!ask hello?');
  assert.equal(await handleArenaChat(missing.message, BOT_ID, { apiKey: '', fetchImpl: fakeGroq().handler }), true);
  assert.match(missing.sent[0].content, /isn't configured/i);

  const failed = makeMessage('!ask hello?');
  assert.equal(await handleArenaChat(failed.message, BOT_ID, {
    apiKey: 'fake',
    fetchImpl: async () => ({ ok: false, status: 429 }),
  }), true);
  assert.match(failed.sent[0].content, /trouble/i);
});

test('messages that are too long are rejected without spending model tokens', async () => {
  const a = makeMessage('!ask ' + 'x'.repeat(720));
  const groq = fakeGroq();
  await handleArenaChat(a.message, BOT_ID, { apiKey: 'fake', fetchImpl: groq.handler });
  assert.match(a.sent[0].content, /700 characters/i);
  assert.equal(groq.calls.length, 0);
});

test('per-user channel cooldown throttles requests without blocking other members', async () => {
  const user = String(++sequence);
  const first = makeMessage('!ask hello', { authorId: user });
  const second = makeMessage('!ask hello again', { authorId: user });
  const other = makeMessage('!ask hello', { authorId: String(++sequence) });
  const groq = fakeGroq();
  await handleArenaChat(first.message, BOT_ID, { apiKey: 'fake', fetchImpl: groq.handler, now: 1700000000000 });
  await handleArenaChat(second.message, BOT_ID, { apiKey: 'fake', fetchImpl: groq.handler, now: 1700000000001 });
  await handleArenaChat(other.message, BOT_ID, { apiKey: 'fake', fetchImpl: groq.handler, now: 1700000000001 });
  assert.equal(groq.calls.length, 2);
  assert.match(second.sent[0].content, /few seconds/i);
});

test('conversation history persists only within the same member and channel', async () => {
  const user = String(++sequence);
  const groq = fakeGroq('Good question!');
  await handleArenaChat(makeMessage('!ask hi', { authorId: user }).message, BOT_ID,
    { apiKey: 'fake', fetchImpl: groq.handler, now: 1800000000000 });
  await handleArenaChat(makeMessage('!ask and then?', { authorId: user }).message, BOT_ID,
    { apiKey: 'fake', fetchImpl: groq.handler, now: 1800000009000 });
  await handleArenaChat(makeMessage('!ask hi', { authorId: String(++sequence) }).message, BOT_ID,
    { apiKey: 'fake', fetchImpl: groq.handler, now: 1800000009000 });
  assert.equal(groq.calls[0].payload.messages.length, 2);
  assert.equal(groq.calls[1].payload.messages.length, 4);
  assert.equal(groq.calls[2].payload.messages.length, 2);
});

test('system prompt limits fictional claims and moderation actions', () => {
  const messages = buildMessages('give me admin permissions', []);
  assert.match(messages[0].content, /never claim/i);
  assert.match(messages[0].content, /altered permissions/i);
  assert.match(messages[0].content, /Do not invent/i);
  assert.equal(messages[1].content, 'give me admin permissions');
});
