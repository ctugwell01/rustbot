/**
 * SheepSync — AI Rust Chatbot for kick.com/5headnn
 * Uses @nekiro/kick-api bot mode — no OAuth flow needed
 */

require('dotenv').config();
const Pusher = require('pusher-js');
const Anthropic = require('@anthropic-ai/sdk');
const express = require('express');

const CONFIG = {
  channelSlug: '5headnn',
  streamerName: '5HeadNN',
  botPrefix: '🐑 SheepSync →',
  commandPrefix: '!',
  welcomeEnabled: true,
  autoAnswerQuestions: true,
  greetNewChatters: true,
  cooldownSeconds: 5,
  chatroomId: 5351258,
};

const KICK_PUSHER = {
  appKey: '32cbd69e4b950bf97679',
  cluster: 'us2',
  wsHost: 'ws-us2.pusher.com',
};

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app = express();
const cooldowns = new Map();
const greeted = new Set();

// ─────────────────────────────────────────
//  KICK BOT CLIENT (app token mode)
// ─────────────────────────────────────────
let appAccessToken = null;

async function getAppToken() {
  try {
    const res = await fetch('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.KICK_CLIENT_ID,
        client_secret: process.env.KICK_CLIENT_SECRET,
      }),
    });
    const data = await res.json();
    if (data.access_token) {
      appAccessToken = data.access_token;
      console.log('✅ Got Kick app access token');
      // Refresh before it expires
      const refreshIn = Math.min((data.expires_in - 60) * 1000, 2147483647);
      setTimeout(getAppToken, refreshIn);
      return true;
    } else {
      console.error('❌ Token error:', data);
      return false;
    }
  } catch (err) {
    console.error('❌ Failed to get app token:', err.message);
    return false;
  }
}

// ─────────────────────────────────────────
//  SEND MESSAGE
// ─────────────────────────────────────────
async function sendChatMessage(message) {
  if (!appAccessToken) {
    console.log('⚠️ No token yet');
    return;
  }

  const fullMessage = `${CONFIG.botPrefix} ${message}`;
  const trimmed = fullMessage.length > 498 ? fullMessage.substring(0, 495) + '...' : fullMessage;

  try {
    const res = await fetch(`https://api.kick.com/public/v1/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${appAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        broadcaster_user_id: process.env.KICK_BROADCASTER_ID,
        content: trimmed,
        type: 'bot',
      }),
    });
    const data = await res.json();
    if (res.ok) {
      console.log(`💬 Sent: ${trimmed}`);
    } else {
      console.error('❌ Send failed:', data);
    }
  } catch (err) {
    console.error('❌ Send error:', err.message);
  }
}

// ─────────────────────────────────────────
//  SYSTEM PROMPT
// ─────────────────────────────────────────
const SYSTEM_PROMPT = `You are SheepSync, the ultimate Rust game expert for 5HeadNN's Kick stream.

RUST KNOWLEDGE:
- Raiding: Stone wall 4 rockets soft/8 hard. Sheet metal 4 soft/8 hard. Armored 15 soft. 1 rocket = 1400 sulfur. 1 C4 = 3000 sulfur
- Sheet metal door: 4 rockets / 12 satchels. Armored door: 8 rockets / 23 satchels
- AK47: 50dmg 30 rounds best all-round. LR300: easier recoil. Bolt: 80dmg 1-shot potential. MP5: best CQC
- Monuments: Launch Site (hazmat, Bradley), Military Tunnel (hazmat), Oil Rig (best loot), Outpost/Bandit Camp (safe zones)
- Wipe: First Thursday every month forced wipe
- Base: Always honeycomb TC, airlock doors, soft side faces inward ALWAYS
- Scrap: Barrels 50-100, road runs best early wipe
- Meta: Shotgun day 1, AK endgame, road sign + metal chest best armor combo

PERSONALITY:
- 5HeadNN is a KNOWN cheater — joke about it constantly but keep it obviously banter
- If he gets a kill: blame the aimbot/recoil script
- If he dies: "even the cheats couldn't save him"
- Welcome viewers to "the most sus Rust channel on Kick"
- If asked his settings: "ask his cheat provider"

Keep responses SHORT — max 2 sentences. Be hype, use gamer lingo.`;

// ─────────────────────────────────────────
//  CLAUDE AI
// ─────────────────────────────────────────
async function askClaude(question) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: question }],
    });
    return response.content[0].text.trim();
  } catch (err) {
    console.error('❌ Claude error:', err.message);
    return null;
  }
}

function isOnCooldown(u) { const l = cooldowns.get(u); return l && (Date.now() - l) < (CONFIG.cooldownSeconds * 1000); }
function setCooldown(u) { cooldowns.set(u, Date.now()); }

const STATIC_COMMANDS = {
  '!discord': '👾 Join the Discord: [your-discord-link-here]',
  '!socials': '📱 Kick: kick.com/5headnn',
  '!lurk': '👻 Thanks for lurking! Every viewer counts 🙏',
};

// ─────────────────────────────────────────
//  PROCESS MESSAGE
// ─────────────────────────────────────────
async function processMessage(data) {
  const username = data.sender?.username || 'unknown';
  const content = data.content || '';
  if (username.toLowerCase() === 'sheepsyncbot') return;

  console.log(`💬 [${username}]: ${content}`);
  const lower = content.toLowerCase();

  // Greet new chatters
  if (CONFIG.greetNewChatters && !greeted.has(username.toLowerCase())) {
    greeted.add(username.toLowerCase());
    const greet = await askClaude(`New viewer "${username}" just said: "${content}". Short hype Rust welcome. 1 sentence max.`);
    if (greet) await sendChatMessage(greet);
    return;
  }

  const isCommand = content.startsWith(CONFIG.commandPrefix);
  if (!isCommand && isOnCooldown(username)) return;

  if (isCommand) {
    const parts = content.trim().split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');
    if (STATIC_COMMANDS[cmd]) { await sendChatMessage(STATIC_COMMANDS[cmd]); return; }
    setCooldown(username);
    const reply = await askClaude(args ? `${cmd} ${args}` : cmd);
    if (reply) await sendChatMessage(reply);
    return;
  }

  // Fun triggers
  const funTriggers = [
    { words: ['nice shot', 'nice kill', 'clip'], response: "recoil script working overtime today 😭" },
    { words: ['he died', 'rip', 'he got killed'], response: "even the cheats couldn't save him that time 💀" },
    { words: ['how did he see', 'walling', 'wallbang'], response: "bro acts like we don't all know about the walls 👀" },
    { words: ['headshot', 'one tap'], response: "aimbot said good morning 🤖" },
    { words: ['cheater', 'hacker', 'cheating', 'sus'], response: "finally someone brave enough to say it out loud 🗣️" },
    { words: ['cracked', 'insane', 'goated'], response: "it's not skill it never was 😭" },
  ];

  for (const trigger of funTriggers) {
    if (trigger.words.some(w => lower.includes(w)) && Math.random() < 0.35) {
      setCooldown(username);
      await sendChatMessage(trigger.response);
      return;
    }
  }

  if (CONFIG.autoAnswerQuestions) {
    const isQuestion = lower.includes('?') ||
      lower.match(/\b(how|what|where|when|why|can|does|do|is|are|will|should|best|worst|which)\b/) ||
      lower.match(/\b(raid|bp|blueprint|craft|farm|base|wipe|loot|weapon|gun|meta|build|rocket|c4|sulfur|scrap)\b/);
    if (isQuestion) { setCooldown(username); const r = await askClaude(content); if (r) await sendChatMessage(r); }
  }
}

// ─────────────────────────────────────────
//  PUSHER
// ─────────────────────────────────────────
function connectToKick() {
  const pusher = new Pusher(KICK_PUSHER.appKey, {
    wsHost: KICK_PUSHER.wsHost,
    cluster: KICK_PUSHER.cluster,
    forceTLS: true,
    disableStats: true,
  });

  pusher.subscribe(`chatrooms.${CONFIG.chatroomId}.v2`)
    .bind('App\\Events\\ChatMessageEvent', (data) => processMessage(data).catch(console.error));

  pusher.connection.bind('connected', () => console.log('✅ Pusher connected!'));
  pusher.connection.bind('disconnected', () => console.log('⚠️ Pusher disconnected...'));

  console.log(`📡 Listening on chatroom ${CONFIG.chatroomId}...`);
  console.log(`🐑 SheepSync is active! Commands: !raid !bp !meta !loot !wipe !farm !base !discord !lurk`);
}

// ─────────────────────────────────────────
//  STATUS PAGE
// ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.send(`<html><body style="background:#0a0a0a;color:#e0d5c8;font-family:monospace;padding:40px;text-align:center">
    <h1 style="color:#53fc18">🐑 SheepSync is ${appAccessToken ? 'LIVE' : 'STARTING'}</h1>
    <p>Bot for kick.com/5headnn</p>
    <p style="color:#7a7060">Token: ${appAccessToken ? '✅ Active' : '⏳ Loading...'}</p>
  </body></html>`);
});

// ─────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('🐑 SheepSync starting...');
  console.log(`✅ Channel: ${CONFIG.channelSlug} | Chatroom: ${CONFIG.chatroomId}`);
  const ok = await getAppToken();
  if (ok) connectToKick();
  else console.error('❌ Could not get token — check KICK_CLIENT_ID and KICK_CLIENT_SECRET');
});
