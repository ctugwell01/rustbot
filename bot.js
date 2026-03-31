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
  botPrefix: '🐑 SheepSync →',
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
async function sendChatMessage(message) {
  const token = await getToken();
  if (!token) { console.log('⚠️ Not authorized yet — visit the Railway URL'); return; }

  const full = `${CONFIG.botPrefix} ${message}`;
  const trimmed = full.length > 498 ? full.substring(0, 495) + '...' : full;

  try {
    const res = await fetch(`https://api.kick.com/public/v1/chat`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ broadcaster_user_id: parseInt(CONFIG.broadcasterId), content: trimmed, type: 'user' }),
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
//  CLAUDE AI
// ─────────────────────────────────────────
const SYSTEM_PROMPT = `You are SheepSync, the ultimate Rust game expert for 5HeadNN's Kick stream.

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

  console.log(`💬 [${username}]: ${content}`);
  const lower = content.toLowerCase();

  if (!greeted.has(username.toLowerCase())) {
    greeted.add(username.toLowerCase());
    const g = await askClaude(`New viewer "${username}" just said: "${content}". Short hype Rust welcome. 1 sentence.`);
    if (g) await sendChatMessage(g);
    return;
  }

  const isCmd = content.startsWith(CONFIG.commandPrefix);
  if (!isCmd && isCD(username)) return;

  if (isCmd) {
    const [cmd, ...rest] = content.trim().split(' ');
    const args = rest.join(' ');
    if (STATIC[cmd.toLowerCase()]) { await sendChatMessage(STATIC[cmd.toLowerCase()]); return; }
    setCD(username);
    const r = await askClaude(args ? `${cmd} ${args}` : cmd);
    if (r) await sendChatMessage(r);
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
      setCD(username); await sendChatMessage(t.r); return;
    }
  }

  const isQ = lower.includes('?') ||
    lower.match(/\b(how|what|where|when|why|can|does|do|is|are|will|should|best|which)\b/) ||
    lower.match(/\b(raid|bp|blueprint|craft|farm|base|wipe|loot|weapon|gun|meta|rocket|c4|sulfur|scrap)\b/);
  if (isQ) { setCD(username); const r = await askClaude(content); if (r) await sendChatMessage(r); }
}

// ─────────────────────────────────────────
//  PUSHER
// ─────────────────────────────────────────
function connectToKick() {
  const pusher = new Pusher('32cbd69e4b950bf97679', {
    wsHost: 'ws-us2.pusher.com', cluster: 'us2', forceTLS: true, disableStats: true,
  });
  pusher.subscribe(`chatrooms.${CONFIG.chatroomId}.v2`)
    .bind('App\\Events\\ChatMessageEvent', d => processMessage(d).catch(console.error));
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
