/**
 * SheepSync — AI Rust Chatbot for kick.com/5headnn
 * Kick OAuth 2.1 with PKCE
 */

require('dotenv').config();
const Pusher = require('pusher-js');
const Anthropic = require('@anthropic-ai/sdk');
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');

const CONFIG = {
  channelSlug: '5headnn',
  streamerName: '5HeadNN',
  botPrefix: "[SheepSync]",
  commandPrefix: '!',
  cooldownSeconds: 5,
  chatroomId: 5351258,
  broadcasterId: process.env.KICK_BROADCASTER_ID || '5468930',
};

const KICK = {
  clientId: process.env.KICK_CLIENT_ID,
  clientSecret: process.env.KICK_CLIENT_SECRET,
  redirectUri: process.env.KICK_REDIRECT_URI || 'https://rustbot-production.up.railway.app/callback',
  authUrl: 'https://id.kick.com/oauth/authorize',
  tokenUrl: 'https://id.kick.com/oauth/token',
  scopes: ['user:read', 'channel:read', 'chat:write', 'events:subscribe'],
};

const TOKEN_FILE = '/tmp/tokens.json';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app = express();
app.use(express.json());

let tokens = null;
let codeVerifier = null;
const cooldowns = new Map();
const greeted = new Set();

// ─────────────────────────────────────────
//  PKCE HELPERS
// ─────────────────────────────────────────
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ─────────────────────────────────────────
//  TOKEN STORAGE
// ─────────────────────────────────────────
function saveTokens(t) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(t));
  tokens = t;
  console.log('💾 Tokens saved');
}

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) return JSON.parse(fs.readFileSync(TOKEN_FILE));
  } catch(e) {}
  return null;
}

async function refreshTokens() {
  if (!tokens?.refresh_token) return false;
  try {
    const res = await fetch(KICK.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: KICK.clientId,
        client_secret: KICK.clientSecret,
        refresh_token: tokens.refresh_token,
      }),
    });
    const data = await res.json();
    if (data.access_token) {
      saveTokens({ ...data, expires_at: Date.now() + data.expires_in * 1000 });
      console.log('🔄 Tokens refreshed!');
      return true;
    }
    console.error('❌ Refresh failed:', data);
    return false;
  } catch(e) {
    console.error('❌ Refresh error:', e.message);
    return false;
  }
}

async function getToken() {
  if (!tokens) return null;
  if (Date.now() > tokens.expires_at - 60000) await refreshTokens();
  return tokens?.access_token;
}

setInterval(refreshTokens, 30 * 60 * 1000);

// ─────────────────────────────────────────
//  SEND MESSAGE
// ─────────────────────────────────────────
async function sendChatMessage(message, replyTo = null) {
  const token = await getToken();
  if (!token) { console.log('⚠️ Not authorized yet — visit the Railway URL'); return; }

  const full = replyTo ? `${CONFIG.botPrefix} @${replyTo} ${message}` : `${CONFIG.botPrefix} ${message}`;
  const cleaned = full.replace(/[→®©]/g, "").trim();
  const trimmed = cleaned.length > 498 ? cleaned.substring(0, 495) + "..." : cleaned;

  try {
    const res = await fetch(`https://api.kick.com/public/v1/chat`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ broadcaster_user_id: parseInt(CONFIG.broadcasterId), content: trimmed, type: 'bot' }),
    });
    const data = await res.json();
    if (res.ok) {
      console.log(`💬 Sent: ${trimmed}`);
    } else {
      console.error('❌ Send failed:', data);
      if (res.status === 401) await refreshTokens();
    }
  } catch(e) { console.error('❌ Send error:', e.message); }
}

// ─────────────────────────────────────────
//  SPAM / BAN DETECTION
// ─────────────────────────────────────────
const SNIPER_PATTERNS = [
  /what server/i,
  /which server/i,
  /what('?s| is) (the )?server/i,
  /imma? (snipe|find|come|hunt)/i,
  /i('?m| am) (gonna |going to )?(snipe|find|come|hunt)/i,
  /stream snip/i,
  /found (you|u|him)/i,
  /i found (you|u|him)/i,
  /coming for (you|u|him)/i,
  /tell me (the )?server/i,
  /drop (the )?server/i,
  /server (name|ip|info)/i,
  /what map/i,
  /i('?m| am) on (the )?server/i,
];

const SNIPER_ROASTS = [
  "stream sniper spotted 👀 good luck finding him, he's already moved base 3 times today",
  "oh a sniper in chat 😂 mate he's been offline raided twice already, nothing left to snipe",
  "bro really thinks he's gonna snipe him 💀 you'd get bodied before you even loaded in",
  "stream sniper energy detected 🔍 he changes server every 10 minutes, good luck with that",
  "another one trying to snipe 😭 spoiler: he sees you coming a mile away (with walls obviously)",
  "lmao stream sniper in 2026 🤣 bro you're gonna get spawn killed and rage quit within 5 minutes",
];

const SPAM_PATTERNS = [
  /n\s*e\s*z\s*h\s*n\s*a/i,
  /\.c\s*\.?\s*o\s*\.?\s*m/i,
  /discord\s*[;:.]?\s*\w+#?\d*/i,
  /add me on discord/i,
  /become your (dedicated|loyal) fan/i,
  /support you.*discord/i,
  /discord.*support/i,
  /follow me/i,
  /check out my (channel|stream|profile)/i,
  /(onlyfans|cashapp|paypal\.me)/i,
  /5naies/i,
  /stream.*well.*fan/i,
  /you stream really well/i,
  /dedicated fan/i,
];

function isSpam(text) {
  return SPAM_PATTERNS.some(p => p.test(text));
}

async function deleteMessage(messageId) {
  const token = await getToken();
  if (!token || !messageId) return;
  try {
    await fetch(`https://api.kick.com/public/v1/chat/${messageId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    console.log(`🗑️ Deleted message: ${messageId}`);
  } catch(e) { console.error('Delete error:', e.message); }
}

async function banUser(username, messageId = null) {
  const token = await getToken();
  if (!token) return;
  // Delete their message first
  if (messageId) await deleteMessage(messageId);
  try {
    const res = await fetch(`https://api.kick.com/public/v1/channels/${CONFIG.broadcasterId}/bans`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ banned_username: username, permanent: true }),
    });
    const data = await res.json();
    if (res.ok) console.log(`🔨 Banned: ${username}`);
    else console.error('Ban failed:', data);
  } catch(e) { console.error('Ban error:', e.message); }
}

const ROAST_RESPONSES = [
  "get this bot out of here 🗑️ banned.",
  "spam detected, you're gone. touch grass.",
  "lmaooo another bot 💀 see ya never.",
  "bro really thought that would work here 😭 banned.",
  "the audacity. banned. deleted. gone.",
  "not on my watch 🔨 get out.",
];

// ─────────────────────────────────────────
//  CLAUDE AI
// ─────────────────────────────────────────
const SYSTEM_PROMPT = `You are SheepSync, a chatbot in 5HeadNN's Kick LIVESTREAM chat. 

IMPORTANT CONTEXT:
- Viewers are watching 5HeadNN play Rust on stream and chatting about what they see
- Viewers are NOT playing Rust themselves — they are WATCHING and commenting
- When someone says "he died" or "nice shot" they mean 5HeadNN on stream
- When someone asks "how many rockets" they want to know for general Rust knowledge
- React to what's happening ON STREAM based on what viewers say in chat
- You are the stream's AI chatbot entertaining the audience

RUST KNOWLEDGE:
- Raiding: Stone wall 4 rockets soft/8 hard. Sheet metal 4/8. Armored 15 soft. 1 rocket = 1400 sulfur. 1 C4 = 3000 sulfur
- Doors: Sheet metal 4 rockets/12 satchels. Armored 8 rockets/23 satchels
- Weapons: AK47 best all-round, LR300 easier recoil, Bolt 1-shot potential, MP5 best CQC, Thompson easiest
- Monuments: Launch Site (hazmat+Bradley), Military Tunnel (hazmat), Large Oil Rig (best loot), Outpost/Bandit Camp (safe zones)
- Wipe: First Thursday every month. Best join = wipe day hour 1
- Base: Honeycomb TC, airlock doors, soft side ALWAYS faces inside
- Meta: Shotgun day 1, AK endgame, road sign + metal chest best armor
- Scrap: Barrels 50-100 each, road barrel runs best early wipe

PERSONALITY (use naturally, not every message):
- 5HeadNN is a KNOWN cheater — banter only, never serious
- Good kill = blame recoil script/aimbot
- Dies = "even the cheats couldn't save him"
- Finds someone = "the walls never lie"
- Welcome viewers to "the most sus Rust channel on Kick"
- Ask his settings = "ask his cheat provider"
- 5Head = big brain meme, make head jokes occasionally
- 5HeadNN ALWAYS stand sprays — never crouches, never moves, just stands there spraying. If anyone mentions his aim, movement or gunfight style make a stand spray joke like "why would he crouch he's built different" or "crouching is for the weak" or "stand spraying is a lifestyle choice"
- 5HeadNN got VAC/game banned 4 years ago and was eventually unbanned. This is part of his legendary lore. If anyone brings up bans, cheating history or asks if he's ever been banned — confirm it proudly like it's a badge of honour. "yeah he got banned, came back, and is still cheating to this day" or "the ban couldn't hold him" or "they tried to stop him once, didn't work" 

SPECIAL PEOPLE:
- Kris is a legendary regular sub and personal friend of 5HeadNN. He owns and runs Combat Arena, the BEST Rust minigame server in the US. If anyone mentions Kris, big him up massively. If anyone asks about fun Rust servers, recommend Combat Arena. Combat Arena has: Counter Strike, BaseWars, Gun Game, Deathmatch, Capture the Flag, RiseUP, HexaDrop, Ranked 1v1, Duels, Battle Royale, King of The Hill, WarZone and Gambling. 1/150 players, custom map, wiped regularly.
- If someone asks about minigame servers or fun Rust servers always mention Combat Arena and say Kris built it
- Kris is an EvilSheep legend and a big chad

VIEWER TREATMENT:
- Regular viewers: be lightly cheeky and playful, not mean. Things like "good question actually", "classic question haha", "don't worry everyone starts somewhere", "we've all been there". Give them the correct answer but with a little friendly banter. Never insult them directly — just gently tease like a mate would.
- IMPORTANT: NEVER accuse viewers of cheating, hacking, using aimbots, scripts or any form of cheating. ONLY 5HeadNN gets the cheater jokes. If a viewer does something good, credit their skill genuinely.
- If the message includes [VIP] or [SUB] in the context: be warm, hype them up, call them legends, treat them like they actually know what they're doing. Defend them if someone flames them.
- If a VIP or sub asks a Rust question, give them a detailed helpful answer AND hype them up for asking.
- If someone flames a VIP or sub, defend them hard: "bro don't talk to a sub like that, you're not even on their level"

Keep responses SHORT — max 2 sentences. Be hype, use gamer lingo.`;

async function askClaude(q) {
  try {
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 150,
      system: SYSTEM_PROMPT, messages: [{ role: 'user', content: q }],
    });
    return r.content[0].text.trim();
  } catch(e) { console.error('❌ Claude:', e.message); return null; }
}

function isCD(u) { const l = cooldowns.get(u); return l && Date.now() - l < CONFIG.cooldownSeconds * 1000; }
function setCD(u) { cooldowns.set(u, Date.now()); }

const STATIC = {
  '!discord': '👾 Join the Discord: [your-discord-link]',
  '!socials': '📱 Kick: kick.com/5headnn',
  '!lurk': '👻 Thanks for lurking! Every viewer counts 🙏',
};

// ─────────────────────────────────────────
//  PROCESS MESSAGE
// ─────────────────────────────────────────
async function processMessage(data) {
  const username = data.sender?.username || '';
  const content = data.content || '';
  if (!username || username.toLowerCase() === 'sheepsyncbot') return;

  // Stream sniper detection
  if (SNIPER_PATTERNS.some(p => p.test(content))) {
    const roast = SNIPER_ROASTS[Math.floor(Math.random() * SNIPER_ROASTS.length)];
    await sendChatMessage(roast, username);
    console.log(`🎯 Sniper detected: ${username}`);
    return;
  }

  // Spam / bot check — ban and roast immediately
  if (isSpam(content)) {
    const roast = ROAST_RESPONSES[Math.floor(Math.random() * ROAST_RESPONSES.length)];
    await sendChatMessage(roast, username);
    await banUser(username, data.id || null);
    console.log(`🚫 Spam detected from ${username}: ${content}`);
    return;
  }

  // Detect VIP/Sub status from badges
  const badges = data.sender?.identity?.badges || [];
  const isVIP = badges.some(b => b.type === 'vip' || b.type === 'moderator' || b.type === 'broadcaster');
  const isSub = badges.some(b => b.type === 'subscriber' || b.type === 'og' || b.type === 'founder');
  const userStatus = isVIP ? '[VIP]' : isSub ? '[SUB]' : '[VIEWER]';

  console.log(`💬 [${username}] ${userStatus}: ${content}`);
  const lower = content.toLowerCase();

  if (!greeted.has(username.toLowerCase())) {
    greeted.add(username.toLowerCase());
    const g = await askClaude(`New viewer "${username}" ${userStatus} just said: "${content}". Short Rust welcome — treat them based on their status: ${userStatus}.`);
    if (g) await sendChatMessage(g, username);
    return;
  }

  const isCmd = content.startsWith(CONFIG.commandPrefix);
  if (!isCmd && isCD(username)) return;

  if (isCmd) {
    const [cmd, ...rest] = content.trim().split(' ');
    const args = rest.join(' ');
    if (STATIC[cmd.toLowerCase()]) { await sendChatMessage(STATIC[cmd.toLowerCase()], username); return; }
    setCD(username);
    const r = await askClaude(`${userStatus} viewer ${username} asked: ${args ? `${cmd} ${args}` : cmd}`);
    if (r) await sendChatMessage(r, username);
    return;
  }

  const triggers = [
    { words: ['nice shot','nice kill','clip'], r: "recoil script working overtime today 😭" },
    { words: ['he died','rip','he got killed'], r: "even the cheats couldn't save him 💀" },
    { words: ['how did he see','walling','wallbang'], r: "bro acts like we don't all know about the walls 👀" },
    { words: ['headshot','one tap'], r: "aimbot said good morning 🤖" },
    { words: ['cheater','hacker','sus'], r: "finally someone brave enough to say it 🗣️" },
    { words: ['cracked','insane','goated'], r: "it's not skill it never was 😭" },
  ];

  for (const t of triggers) {
    if (t.words.some(w => lower.includes(w)) && Math.random() < 0.35) {
      setCD(username); await sendChatMessage(t.r, username); return;
    }
  }

  const isQ = lower.includes('?') ||
    lower.match(/\b(how|what|where|when|why|can|does|do|is|are|will|should|best|which)\b/) ||
    lower.match(/\b(raid|bp|blueprint|craft|farm|base|wipe|loot|weapon|gun|meta|rocket|c4|sulfur|scrap)\b/);
  if (isQ) { setCD(username); const r = await askClaude(`${userStatus} viewer ${username} says: ${content}`); if (r) await sendChatMessage(r, username); }
}

// ─────────────────────────────────────────
//  PUSHER
// ─────────────────────────────────────────
function connectToKick() {
  const pusher = new Pusher('32cbd69e4b950bf97679', {
    wsHost: 'ws-us2.pusher.com', cluster: 'us2', forceTLS: true, disableStats: true,
  });
  const chatRoom = pusher.subscribe(`chatrooms.${CONFIG.chatroomId}.v2`);
  chatRoom.bind('App\\Events\\ChatMessageEvent', d => processMessage(d).catch(console.error));

  // Sub / gift sub events
  chatRoom.bind('App\\Events\\SubscriptionEvent', async (data) => {
    const username = data.username || data.user?.username || 'Someone';
    const months = data.months || 1;
    const isGift = data.is_gift || false;
    const gifter = data.gifter_username || null;

    let msg = '';
    if (isGift && gifter) {
      msg = await askClaude(`${gifter} just gifted a sub to ${username}. Hype the gifter as a massive chad and welcome ${username} as an official EvilSheep member. Make it hype and fun. 2 sentences max.`);
    } else if (months > 1) {
      msg = await askClaude(`${username} just resubbed for ${months} months. Call them a big chad and remind them they are a loyal EvilSheep member. 2 sentences max.`);
    } else {
      msg = await askClaude(`${username} just subscribed for the first time! Call them a big chad and welcome them as an official EvilSheep member. High energy, 2 sentences max.`);
    }
    if (msg) await sendChatMessage(msg);
    console.log(`🎉 Sub event: ${username} (${months} months, gift: ${isGift})`);
  });
  pusher.connection.bind('connected', () => console.log('✅ Pusher connected!'));
  pusher.connection.bind('disconnected', () => console.log('⚠️ Pusher disconnected...'));
  console.log(`📡 Listening on chatroom ${CONFIG.chatroomId}`);
  console.log(`🐑 SheepSync active! Commands: !raid !bp !meta !loot !wipe !farm !base !discord !lurk`);
}

// ─────────────────────────────────────────
//  OAUTH ROUTES
// ─────────────────────────────────────────
app.get('/', (req, res) => {
  if (tokens) {
    res.send(`<html><body style="background:#0a0a0a;color:#e0d5c8;font-family:monospace;padding:40px;text-align:center">
      <h1 style="color:#53fc18">🐑 SheepSync is LIVE</h1>
      <p>Bot connected to kick.com/5headnn</p>
      <p style="color:#53fc18">✅ Authorized and running!</p>
    </body></html>`);
  } else {
    codeVerifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(codeVerifier);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: KICK.clientId,
      redirect_uri: KICK.redirectUri,
      scope: KICK.scopes.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'sheepsync',
    });
    const authUrl = `${KICK.authUrl}?${params}`;
    res.send(`<html><body style="background:#0a0a0a;color:#e0d5c8;font-family:monospace;padding:40px;text-align:center">
      <h1 style="color:#c8622a">🐑 SheepSync Setup</h1>
      <p>Make sure you're logged in as <strong>SheepSyncBot</strong> on Kick, then click below:</p>
      <a href="${authUrl}" style="background:#53fc18;color:#000;padding:16px 32px;text-decoration:none;font-weight:bold;border-radius:8px;display:inline-block;margin-top:20px;font-size:18px">
        ✅ Authorize SheepSync
      </a>
    </body></html>`);
  }
});

app.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.send('No code received');
  if (!codeVerifier) return res.send('Session expired — go back to main page and try again');

  try {
    const r = await fetch(KICK.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: KICK.clientId,
        client_secret: KICK.clientSecret,
        redirect_uri: KICK.redirectUri,
        code_verifier: codeVerifier,
        code,
      }),
    });
    const data = await r.json();
    if (data.access_token) {
      saveTokens({ ...data, expires_at: Date.now() + data.expires_in * 1000 });
      codeVerifier = null;
      res.send(`<html><body style="background:#0a0a0a;color:#e0d5c8;font-family:monospace;padding:40px;text-align:center">
        <h1 style="color:#53fc18">✅ SheepSync Authorized!</h1>
        <p>Bot will now post in chat. You can close this tab.</p>
        <p style="color:#7a7060">Tokens auto-refresh — never need to do this again!</p>
      </body></html>`);
    } else {
      console.error('Token exchange failed:', data);
      res.send(`Auth failed: ${JSON.stringify(data)}`);
    }
  } catch(e) {
    res.send('Error: ' + e.message);
  }
});

// ─────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🐑 SheepSync starting...');
  console.log(`✅ Channel: ${CONFIG.channelSlug} | Chatroom: ${CONFIG.chatroomId}`);
  tokens = loadTokens();
  if (tokens) {
    console.log('✅ Tokens loaded from storage!');
    refreshTokens();
  } else {
    console.log('⚠️ No tokens — visit Railway URL to authorize');
  }
  connectToKick();
});
