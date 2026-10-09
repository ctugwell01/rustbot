'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPromotionDetector, scoreMessages } = require('../promotion-detector');

test('catches all three messages from the reported Kick growth scam independently', () => {
  const messages = [
    'Hey homie, I can share your stream in a kick community',
    'to help you hit 1000 followers and 800 viewers also earn $1,000 per stream',
    "Let's chat. Add me up on Discord 👉👉 catalystreach",
  ];
  for (const message of messages) {
    assert.equal(scoreMessages([message]).isSpam, true, message);
  }
});

test('catches variants without a fixed scammer handle or growth target', () => {
  const pitches = [
    'We could promote your channel to a streamer community',
    'I can boost your stream for more exposure',
    'Want to get 1200 followers and 300 viewers fast?',
    'Contact me via Telegram for details',
    'DM me on Discord to discuss this',
    'I can help you get followers and earn £500 per stream',
    'I can share your stream in a gaming group',
  ];
  for (const text of pitches) {
    assert.equal(scoreMessages([text]).isSpam, true, text);
  }
});

test('combines a fragmented sales pitch from the same user', () => {
  let time = 10_000;
  const detector = createPromotionDetector({ now: () => time });
  assert.equal(detector.check('Promoter', 'I can share your stream').isSpam, false);
  assert.equal(detector.check('Promoter', 'in a Kick community').isSpam, true);
  assert.equal(detector.check('Promoter', 'message me on Discord').isSpam, true);
});

test('does not combine different chatters or old messages', () => {
  let time = 10_000;
  const detector = createPromotionDetector({ now: () => time, windowMs: 60_000 });
  assert.equal(detector.check('alice', 'I can share your stream').isSpam, false);
  assert.equal(detector.check('bob', 'in a Kick community').isSpam, false);
  time += 70_000;
  assert.equal(detector.check('alice', 'in a Kick community').isSpam, false);
});

test('does not moderate ordinary chat, quotes of viewer stats, or Discord discussion', () => {
  const innocent = [
    'Thanks for the follow @RedManRunner!',
    'Just hit 1000 followers, thank you everyone!',
    'I had 800 viewers during the stream yesterday',
    'Your stream was great today',
    'Are you in the Kick community?',
    'My friend added me on Discord',
    "Let's chat about Rust builds sometime",
    'Please share your stream link when you go live',
    'Can someone share my stream in the community?',
    'I earned $200 per stream last month',
    'How could I earn $1000 per stream?',
  ];
  const detector = createPromotionDetector();
  for (const message of innocent) {
    assert.equal(detector.check('Viewer', message).isSpam, false, message);
  }
});

test('normalizes case and invisible characters in direct contact solicitations', () => {
  assert.equal(scoreMessages(['ADD ME UP ON D\u200bISCORD']).isSpam, true);
});
