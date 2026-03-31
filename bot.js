/**
 * SheepSync — AI Rust Chatbot for kick.com/5headnn
 * Uses Kick OAuth 2.1 — tokens auto-refresh, never expire
 */

require('dotenv').config();
const Pusher = require('pusher-js');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const express = require('express');
const fs = require('fs');

// ─────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────
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

const KICK_OAUTH = {
  clientId: process.env.KICK_CLIENT_ID,
  clientSecret: process.env.KICK_CLIENT_SECRET,
  redirectUri: process.env.KICK_REDIRECT_URI || 'https://sheepsync.up.railway.app/callback',
  authUrl: 'https://kick.com/oauth2/authorize',
  tokenUrl: 'https://kick.com/oauth2/token',
  scopes: 'user:read channel:read chat:write events:subscribe',
};

const KICK_PUSHER = {
  appKey: '32cbd69e4b950bf97679',
  cluster: 'us2',
  wsHost: 'ws-us2.pusher.com',
};

// ─────────────────────────────────────────
//  TOKEN STORAGE
// ─────────────────────────────────────────
const TOKEN_FILE = '/tmp/sheepsync_tokens.json';

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens));
  console.log('💾 Tokens saved');
}

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE));
    }
  } catch (e) {}
  return null;
}

let tokens = loadTokens();

// ─────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app = express();
const cooldowns = new Map();
const greeted = new Set();
let chatroomId = CONFIG.chatroomId;
let pusherInstance = null;

// ─────────────────────────────────────────
//  RUST + PERSONALITY SYSTEM PROMPT
// ─────────────────────────────────────────
const SYSTEM_PROMPT = `You are SheepSync, the ultimate Rust game expert for 5HeadNN's Kick stream.

RUST KNOWLEDGE:
- Raiding: Wood wall 2 rockets, Stone wall 4 rockets soft/8 hard, Sheet metal 4 soft/8 hard, Armored 15 soft. 1 rocket = 1400 sulfur. 1 C4 = 3000 sulfur
- Sheet metal door: 4 rockets / 12 satchels. Armored door: 8 rockets / 23 satchels
- AK47: 50dmg 30 rounds best all-round. LR300: easier recoil. Bolt: 80dmg 1-shot potential. MP5: best CQC. Thompson: easiest recoil
- Monuments: Launch Site (hazmat, Bradley), Military Tunnel (hazmat, green card), Oil Rig (no rads, heavy loot), Outpost/Bandit Camp (safe zones)
- Wipe: First Thursday every month forced wipe
- Base: Always honeycomb TC, airlock doors, soft side faces inward ALWAYS
- Scrap: Barrels 50-100, road runs best early wipe
- Meta: Shotgun day 1, AK endgame, road sign + metal chest best armor combo

PERSONALITY & RUNNING JOKES:
- 5HeadNN is a KNOWN cheater — joke about it constantly but keep it obviously banter
- If he gets a kill: blame the aimbot/recoil script
- If he dies: "even the cheats couldn't save him"
- If he finds someone: "the walls never lie"
- Welcome viewers to "the most sus Rust channel on Kick"
- 5Head = big brain meme, make head jokes
- If asked his settings: "ask his cheat provider"
- Never serious accusations — always obvious banter

Keep responses SHORT — max 2 sentences. Be hype, use gamer lingo. No fluff.`;

// ─────────────────────────────────────────
//  OAUTH SERVER
// ─────────────────────────────────────────
app.get('/', (req, res) => {
  if (tokens) {
    res.send(`
      <html><body style="background:#0a0a0a;color:#e0d5c8;font-family:monospace;padding:40px;text-align:center">
        <h1 style="color:#53fc18">🐑 SheepSync is LIVE</h1>
        <p>Bot is connected and running for kick.com/5headnn</p>
        <p style="color:#7a7060">Tokens are active and auto-refreshing</p>
      </body></html>
    `);
  } else {
    const authUrl = `${KICK_OAUTH.authUrl}?client_id=${KICK_OAUTH.clientId}&redirect_uri=${encodeURIComponent(KICK_OAUTH.redirectUri)}&response_type=code&scope=${encodeURIComponent(KICK_OAUTH.scopes)}`;
    res.send(`
      <html><body style="background:#0a0a0a;color:#e0d5c8;font-family:monospace;padding:40px;text-align:center">
        <h1 style="color:#c8622a">🐑 SheepSync Setup</h1>
        <p>Click below to authorize SheepSync to post in your chat</p>
        <a href="${authUrl}" style="background:#53fc18;color:#000;padding:16px 32px;text-decoration:none;font-weight:bold;border-radius:8px;display:inline-block;margin-top:20px">
          Authorize SheepSync on Kick
        </a>
      </body></html>
    `);
  }
});

app.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.send('No code received');

  try {
    const response = await axios.post(KICK_OAUTH.tokenUrl, {
      grant_type: 'authorization_code',
      client_id: KICK_OAUTH.clientId,
      client_secret: KICK_OAUTH.clientSecret,
      redirect_uri: KICK_OAUTH.redirectUri,
      code,
    });

    tokens = response.data;
    tokens.expires_at = Date.now() + (tokens.expires_in * 1000);
    saveTokens(tokens);

    console.log('✅ OAuth tokens received and saved!');
    res.send(`
      <html><body style="background:#0a0a0a;color:#e0d5c8;font-family:monospace;padding:40px;text-align:center">
        <h1 style="color:#53fc18">✅ SheepSync Authorized!</h1>
        <p>Bot is now connected and will post in chat. You can close this tab.</p>
      </body></html>
    `);

    // Start the bot if not already running
    if (!pusherInstance) connectToKick();

  } catch (err) {
    console.error('❌ OAuth error:', err.response?.data || err.message);
    res.send('Authorization failed — check logs');
  }
});

// ─────────────────────────────────────────
//  TOKEN REFRESH
// ─────────────────────────────────────────
async function refreshTokens() {
  if (!tokens?.refresh_token) return false;
  try {
    const response = await axios.post(KICK_OAUTH.tokenUrl, {
      grant_type: 'refresh_token',
      client_id: KICK_OAUTH.clientId,
      client_secret: KICK_OAUTH.clientSecret,
      refresh_token: tokens.refresh_token,
    });
    tokens = response.data;
    tokens.expires_at = Date.now() + (tokens.expires_in * 1000);
    saveTokens(tokens);
    console.log('🔄 Tokens refreshed!');
    return true;
  } catch (err) {
    console.error('❌ Token refresh failed:', err.response?.data || err.message);
    return false;
  }
}

async function getValidToken() {
  if (!tokens) return null;
  if (Date.now() > (tokens.expires_at - 60000)) {
    await refreshTokens();
  }
  return tokens?.access_token;
}

// Auto-refresh every 30 minutes
setInterval(refreshTokens, 30 * 60 * 1000);

// ─────────────────────────────────────────
//  SEND MESSAGE
// ─────────────────────────────────────────
async function sendChatMessage(message) {
  const token = await getValidToken();
  if (!token) {
    console.log('⚠️ No token — visit the Railway URL to authorize');
    return;
  }

  const fullMessage = `${CONFIG.botPrefix} ${message}`;
  const trimmed = fullMessage.length > 498 ? fullMessage.substring(0, 495) + '...' : fullMessage;

  try {
    await axios.post(
      `https://kick.com/api/v2/messages/send/${chatroomId}`,
      { content: trimmed, type: 'message' },
      { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' } }
    );
    console.log(`💬 Sent: ${trimmed}`);
  } catch (err) {
    console.error('❌ Failed to send:', err.response?.data || err.message);
    if (err.response?.status === 401) await refreshTokens();
  }
}

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

// ─────────────────────────────────────────
//  COOLDOWN
// ─────────────────────────────────────────
function isOnCooldown(username) {
  const last = cooldowns.get(username);
  return last && (Date.now() - last) < (CONFIG.cooldownSeconds * 1000);
}
function setCooldown(username) { cooldowns.set(username, Date.now()); }

// ─────────────────────────────────────────
//  STATIC COMMANDS
// ─────────────────────────────────────────
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
  const isSelf = username.toLowerCase() === 'sheepsyncbot';
  if (isSelf) return;

  console.log(`💬 [${username}]: ${content}`);

  const lower = content.toLowerCase();

  // Greet new chatters
  if (CONFIG.greetNewChatters && !greeted.has(username.toLowerCase())) {
    greeted.add(username.toLowerCase());
    const greet = await askClaude(`New viewer "${username}" just said: "${content}". Give a short hype Rust-flavoured welcome. 1 sentence max.`);
    if (greet) await sendChatMessage(greet);
    return;
  }

  const isCommand = content.startsWith(CONFIG.commandPrefix);
  if (!isCommand && isOnCooldown(username)) return;

  // Static commands
  if (isCommand) {
    const parts = content.trim().split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    if (STATIC_COMMANDS[cmd]) {
      await sendChatMessage(STATIC_COMMANDS[cmd]);
      return;
    }

    setCooldown(username);
    const reply = await askClaude(args ? `${cmd} ${args}` : cmd);
    if (reply) await sendChatMessage(reply);
    return;
  }

  // Fun auto-triggers
  const funTriggers = [
    { words: ['nice shot', 'nice kill', 'clip'], response: "recoil script working overtime today 😭" },
    { words: ['he died', 'rip', 'he got killed'], response: "even the cheats couldn't save him that time 💀" },
    { words: ['how did he see', 'walling', 'wallbang'], response: "bro acts like we don't all know about the walls 👀" },
    { words: ['headshot', 'one tap', 'onetap'], response: "aimbot said good morning 🤖" },
    { words: ['cheater', 'hacker', 'cheating', 'sus'], response: "finally someone brave enough to say it out loud 🗣️" },
    { words: ['cracked', 'insane', 'goated', 'how is he so good'], response: "it's not skill it never was 😭" },
  ];

  for (const trigger of funTriggers) {
    if (trigger.words.some(w => lower.includes(w))) {
      if (Math.random() < 0.35) {
        setCooldown(username);
        await sendChatMessage(trigger.response);
        return;
      }
    }
  }

  // Auto-answer Rust questions
  if (CONFIG.autoAnswerQuestions) {
    const isQuestion =
      lower.includes('?') ||
      lower.match(/\b(how|what|where|when|why|can|does|do|is|are|will|should|best|worst|which)\b/) ||
      lower.match(/\b(raid|bp|blueprint|craft|farm|base|wipe|loot|weapon|gun|meta|build|rocket|c4|sulfur|scrap)\b/);

    if (isQuestion) {
      setCooldown(username);
      const reply = await askClaude(content);
      if (reply) await sendChatMessage(reply);
    }
  }
}

// ─────────────────────────────────────────
//  CONNECT TO KICK
// ─────────────────────────────────────────
function connectToKick() {
  const pusher = new Pusher(KICK_PUSHER.appKey, {
    wsHost: KICK_PUSHER.wsHost,
    cluster: KICK_PUSHER.cluster,
    forceTLS: true,
    disableStats: true,
  });

  pusherInstance = pusher;

  const chatChannel = pusher.subscribe(`chatrooms.${chatroomId}.v2`);
  chatChannel.bind('App\\Events\\ChatMessageEvent', (data) => {
    processMessage(data).catch(console.error);
  });

  pusher.connection.bind('connected', () => console.log('✅ Pusher connected to Kick!'));
  pusher.connection.bind('disconnected', () => console.log('⚠️ Pusher disconnected — reconnecting...'));

  // Welcome message on stream live
  pusher.subscribe(`channel.${CONFIG.channelSlug}`);

  console.log(`📡 Listening on chatroom ${chatroomId}...`);
  console.log(`🐑 SheepSync is active for channel: ${CONFIG.channelSlug}`);
  console.log(`💡 Commands: !raid, !bp, !meta, !loot, !wipe, !farm, !base, !discord, !lurk`);
}

// ─────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('🐑 SheepSync starting up...');
  console.log(`🌐 Web server running on port ${PORT}`);
  console.log(`✅ Channel: ${CONFIG.channelSlug} | Chatroom ID: ${chatroomId}`);

  if (tokens) {
    console.log('✅ Tokens loaded — connecting to Kick...');
    connectToKick();
  } else {
    console.log('⚠️  No tokens found!');
    console.log('👉 Visit your Railway URL to authorize SheepSync');
  }
});
