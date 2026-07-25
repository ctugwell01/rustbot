/**
 * SheepSync —
  /remove\\s+space/i,
  /keep\\s+(the\\s+)?chat\\s+alive/i,
  /grow\\s+your\\s+audience/i,
  /stream\\s+more\\s+active/i,
  /help\\s+you\\s+grow/i,
  /bots?\\s+keep/i,
  /ai\\s+bots?\\s+(keep|help|grow)/i, AI Rust Chatbot for kick.com/5headnn
  /tired\s+of\s+streaming\s+to\s+(zero|0|1)\s*(view|viewer)?/i,
  /streaming\s+to\s+(zero|0|1)\s*(view|viewer)?/i,
  /tired\s+of\s+(zero|0|1)\s*(view|viewer)/i,
  /are\s+you\s+tired\s+of/i,
  /let.?s\s+change\s+that/i,
  /nezhna/i,
 * Kick OAuth 2.1 with PKCE
 */

require('dotenv').config();

let announceGoLive = async () => {};
// Load Discord bot async after startup so it doesn't block Express
setTimeout(() => {
  try {
    const discord = require('./discord');
    announceGoLive = discord.announceGoLive || (async () => {});
    console.log('Discord bot loaded');
  } catch(e) {
    console.error('Discord bot error:', e.message);
  }
}, 2000);
const Pusher = require('pusher-js');
const Anthropic = require('@anthropic-ai/sdk');
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');

// ─────────────────────────────────────────
//  MEMORY SYSTEM
// ─────────────────────────────────────────
const MEMORY_FILE = '/tmp/sheepsync_memory.json';
let memory = {
  chatters: {},      // username -> { vibes, jokes, lastSeen, subbed, times }
  insideJokes: [],   // funny moments from stream
  streamNotes: [],   // things that happened
  lastUpdated: null,
};

function loadMemory() {
  // Try env var first
  if (process.env.SAVED_MEMORY) {
    try {
      memory = JSON.parse(Buffer.from(process.env.SAVED_MEMORY, 'base64').toString());
      console.log(`🧠 Memory loaded — ${Object.keys(memory.chatters).length} chatters remembered`);
      return;
    } catch(e) {}
  }
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      memory = JSON.parse(fs.readFileSync(MEMORY_FILE));
      console.log(`🧠 Memory loaded from file`);
    }
  } catch(e) {}
}

async function saveMemory() {
  try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory)); } catch(e) {}
  // Save to Railway Variables every 30 mins
  if (Date.now() - (memory.lastSaved || 0) > 30 * 60 * 1000) {
    memory.lastSaved = Date.now();
    try {
      await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RAILWAY_API_TOKEN}` },
        body: JSON.stringify({
          query: `mutation { variableUpsert(input: { projectId: "5e70915b-a789-4319-9291-31b531415d71", environmentId: "${process.env.RAILWAY_ENVIRONMENT_ID || ''}", serviceId: "35b9fd38-ec7b-4ec7-9fbc-31599a09119a", name: "SAVED_MEMORY", value: "${Buffer.from(JSON.stringify(memory)).toString('base64')}" }) }`,
        }),
      });
      console.log('🧠 Memory saved to Railway');
    } catch(e) {}
  }
}

function updateChatterMemory(username, content, userStatus) {
  if (!memory.chatters[username]) {
    memory.chatters[username] = {
      firstSeen: new Date().toISOString(),
      messageCount: 0,
      isVIP: false,
      isSub: false,
      notes: [],
    };
  }
  const chatter = memory.chatters[username];
  chatter.lastSeen = new Date().toISOString();
  chatter.messageCount++;
  chatter.isVIP = userStatus === '[VIP]' || userStatus === '[MOD]' || userStatus === '[OWNER]';
  chatter.isSub = userStatus === '[SUB]' || userStatus === '[CHAD]';
  
  // Save memory periodically
  if (chatter.messageCount % 10 === 0) saveMemory();
}

function getChatterContext(username) {
  const chatter = memory.chatters[username];
  if (!chatter || chatter.messageCount < 3) return '';
  return `[Memory: ${username} has chatted ${chatter.messageCount} times, first seen ${chatter.firstSeen.split('T')[0]}${chatter.notes.length > 0 ? ', notes: ' + chatter.notes.slice(-2).join(', ') : ''}]`;
}

const CONFIG = {
  channelSlug: '5headnn',
  streamerName: '5HeadNN',
  botPrefix: '',
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

// Mod app — 5headnn account for banning
const KICK_MOD = {
  clientId: '01KNKY7E4FYYKG53FRSK3P28D0',
  clientSecret: '7bc3d62980f363fd5af7644d016ef38ed11e2ac41da25dd62f3918068512b474',
  redirectUri: 'https://rustbot-production.up.railway.app/mod-callback',
  authUrl: 'https://id.kick.com/oauth/authorize',
  tokenUrl: 'https://id.kick.com/oauth/token',
  scopes: ['user:read', 'channel:read', 'events:subscribe', 'channel:write', 'moderation:ban'],
};

let modTokens = null;
const MOD_TOKEN_FILE = '/tmp/mod_tokens.json';

function loadModTokens() {
  if (process.env.SAVED_MOD_TOKENS) {
    try { return JSON.parse(Buffer.from(process.env.SAVED_MOD_TOKENS, 'base64').toString()); } catch(e) {}
  }
  try {
    if (require('fs').existsSync(MOD_TOKEN_FILE)) return JSON.parse(require('fs').readFileSync(MOD_TOKEN_FILE));
  } catch(e) {}
  return null;
}

async function saveModTokens(t) {
  modTokens = t;
  try { require('fs').writeFileSync(MOD_TOKEN_FILE, JSON.stringify(t)); } catch(e) {}
  try {
    await fetch('https://backboard.railway.app/graphql/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RAILWAY_API_TOKEN}` },
      body: JSON.stringify({
        query: `mutation { variableUpsert(input: { projectId: "5e70915b-a789-4319-9291-31b531415d71", environmentId: "${process.env.RAILWAY_ENVIRONMENT_ID || ''}", serviceId: "35b9fd38-ec7b-4ec7-9fbc-31599a09119a", name: "SAVED_MOD_TOKENS", value: "${Buffer.from(JSON.stringify(t)).toString('base64')}" }) }`,
      }),
    });
    console.log('💾 Mod tokens saved to Railway');
  } catch(e) { console.error('Failed to save mod tokens:', e.message); }
}

async function getModToken() {
  if (!modTokens) return null;
  if (Date.now() > modTokens.expires_at - 60000) {
    try {
      const r = await fetch(KICK_MOD.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: KICK_MOD.clientId,
          client_secret: KICK_MOD.clientSecret,
          refresh_token: modTokens.refresh_token,
        }),
      });
      const data = await r.json();
      if (data.access_token) {
        await saveModTokens({ ...data, expires_at: Date.now() + data.expires_in * 1000 });
        console.log('🔄 Mod tokens refreshed');
      }
    } catch(e) { console.error('Mod token refresh failed:', e.message); }
  }
  return modTokens?.access_token;
}

const TOKEN_FILE = '/tmp/tokens.json';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app = express();
app.use(express.json());

let tokens = null;
let codeVerifier = null;
let lastRailwaySave = 0;
const cooldowns = new Map();
const greeted = new Set();
const returning = new Set();
let streamStartTime = null;

// Raid detection
const recentMessages = new Map(); // message content -> [{username, timestamp}]
let raidMode = false;

async function checkForRaid(username, content) {
  const now = Date.now();
  const key = content.toLowerCase().trim().substring(0, 50);
  
  if (!recentMessages.has(key)) recentMessages.set(key, []);
  const msgs = recentMessages.get(key);
  
  // Add this message
  msgs.push({ username, timestamp: now });
  
  // Clean old messages (older than 30 seconds)
  const fresh = msgs.filter(m => now - m.timestamp < 30000);
  recentMessages.set(key, fresh);
  
  // If 3+ different users sent the same message in 30 seconds = raid
  const uniqueUsers = new Set(fresh.map(m => m.username));
  if (uniqueUsers.size >= 3 && !raidMode) {
    raidMode = true;
    console.log('🚨 RAID DETECTED! Activating raid mode...');
    
    // Ban all raiders
    for (const raider of uniqueUsers) {
      await banUser(raider);
    }
    
    // Warn chat
    await sendChatMessage('raid detected — banning all involved. chat will return to normal shortly.');
    
    // Alert Discord
    try {
      const discord = require('./discord');
      if (discord.alertSniper) await discord.alertSniper('RAID ALERT', `Coordinated raid detected! ${uniqueUsers.size} accounts sending: "${content.substring(0, 100)}"`);
    } catch(e) {}
    
    // Reset raid mode after 2 minutes
    setTimeout(() => { raidMode = false; recentMessages.clear(); }, 120000);
    return true;
  }
  return false;
}

const AUTO_MESSAGES = [
  "if you're enjoying the stream smash that follow button, costs nothing and means everything",
  "new here? chuck a follow and join the EvilSheep gang, we dont bite... much",
  "subs get treated like royalty around here, just saying. !discord to join the community",
  "reminder that !commands exist if you want Rust help from your favourite Welsh degen bot",
  "if 5head carries this fight its the cheats. if he dies its skill issue. simple as",
  "use !predict to see if 5head wins his next fight, spoiler: the scripts decide",
  "enjoying the chaos? follow the channel and join the EvilSheep Discord: https://discord.gg/4DHRdH9dz5",
  "subs are big chads. NNs are NNs. the choice is yours lads",
  () => `tip goal: £${subGoal.current}/£${subGoal.target} raised — help 5HeadNN buy his mum an AC unit before summer! donate with !donate 🐑`,
];

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
async function saveTokens(t) {
  tokens = { ...t, saved_at: Date.now() };
  // Always save refresh token separately
  if (t.refresh_token) {
    try { fs.writeFileSync('/tmp/refresh_token.txt', t.refresh_token); } catch(e) {}
  }
  // Save to file
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens)); } catch(e) {}
  console.log(`✅ Tokens saved — expires in ${Math.floor((t.expires_at - Date.now())/60000)} mins`);
  // Save to Railway Variables so they survive redeploys
  try {
    await fetch(`https://backboard.railway.app/graphql/v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RAILWAY_API_TOKEN}`,
      },
      body: JSON.stringify({
        query: `mutation { variableUpsert(input: { projectId: "5e70915b-a789-4319-9291-31b531415d71", environmentId: "${process.env.RAILWAY_ENVIRONMENT_ID || ''}", serviceId: "35b9fd38-ec7b-4ec7-9fbc-31599a09119a", name: "SAVED_TOKENS", value: "${Buffer.from(JSON.stringify(t)).toString('base64')}" }) }`,
      }),
    });
    lastRailwaySave = Date.now();
    console.log('💾 Tokens saved to Railway Variables');
  } catch(e) {
    console.error('Failed to save to Railway:', e.message);
  }
}

function loadTokens() {
  // Try Railway Variable first
  if (process.env.SAVED_TOKENS) {
    try {
      const t = JSON.parse(Buffer.from(process.env.SAVED_TOKENS, 'base64').toString());
      console.log('✅ Tokens loaded from Railway Variables');
      return t;
    } catch(e) {}
  }
  // Fall back to file
  try {
    if (fs.existsSync(TOKEN_FILE)) return JSON.parse(fs.readFileSync(TOKEN_FILE));
  } catch(e) {}
  // Try backup refresh token
  try {
    if (fs.existsSync('/tmp/refresh_token.txt')) {
      const refreshToken = fs.readFileSync('/tmp/refresh_token.txt', 'utf8').trim();
      if (refreshToken) {
        console.log('🔄 Found backup refresh token — attempting restore...');
        return { refresh_token: refreshToken, expires_at: 0, access_token: null };
      }
    }
  } catch(e) {}
  return null;
}

let isRefreshing = false;
async function refreshTokens() {
  if (!tokens?.refresh_token) return false;
  if (isRefreshing) return false;
  isRefreshing = true;
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
      isRefreshing = false;
      return true;
    }
    console.error('❌ Refresh failed — clearing tokens, re-auth required:', data);
    tokens = null;
    isRefreshing = false;
    // Notify via Discord so you don't need to check Railway URL
    try {
      const d = require('./discord');
      const authLink = `https://rustbot-production.up.railway.app`;
      if (d.notifyOwner) d.notifyOwner(`⚠️ SheepSync needs re-auth! Kick tokens expired.\nClick to re-authorize: ${authLink}`).catch(()=>{});
    } catch(e) {}
    return false;
  } catch(e) {
    console.error('❌ Refresh error:', e.message);
    isRefreshing = false;
    return false;
  }
}

async function getToken() {
  if (!tokens) return null;
  const timeLeft = tokens.expires_at - Date.now();
  if (timeLeft < 300000) { // Refresh if less than 5 mins left
    console.log(`⏱️ Token expires in ${Math.floor(timeLeft/60000)} mins — refreshing...`);
    await refreshTokens();
  }
  return tokens?.access_token;
}

setInterval(refreshTokens, 10 * 60 * 1000); // Refresh every 10 minutes

// Check token freshness every 2 minutes and auto-refresh if needed
setInterval(async () => {
  if (!tokens) return;
  const timeLeft = tokens.expires_at - Date.now();
  if (timeLeft < 0) {
    // Token is already expired — try once then clear if it fails
    console.log(`⚠️ Token expired ${Math.abs(Math.floor(timeLeft/60000))} mins ago — attempting refresh...`);
    const ok = await refreshTokens();
    if (!ok) {
      console.log('⚠️ Refresh failed — clearing stale tokens. Re-auth at your Railway URL.');
      tokens = null;
    }
    return;
  }
  if (timeLeft < 10 * 60 * 1000) {
    console.log(`⏱️ Token has ${Math.floor(timeLeft/60000)} mins left — refreshing...`);
    await refreshTokens();
  }
}, 2 * 60 * 1000);

// ─────────────────────────────────────────
//  SEND MESSAGE
// ─────────────────────────────────────────
async function sendChatMessage(message, replyTo = null) {
  const token = await getToken();
  if (!token) { console.log('⚠️ Not authorized yet — visit the Railway URL'); return; }

  const full = replyTo ? `@${replyTo} ${message}` : message;
  const cleaned = full.replace(/[→®©]/g, "").trim();
  const trimmed = cleaned.length > 498 ? cleaned.substring(0, 495) + "..." : cleaned;

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
      if (res.status === 401) {
        console.log('🔄 Token unauthorized — forcing refresh...');
        const oldTokens = tokens; // Keep old tokens for refresh
        const refreshed = await refreshTokens();
        if (!refreshed) tokens = oldTokens; // Restore if refresh failed
        if (refreshed && tokens) {
          // Retry the message once
          try {
            const retryRes = await fetch(`https://api.kick.com/public/v1/chat`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ broadcaster_user_id: parseInt(CONFIG.broadcasterId), content: trimmed, type: 'user' }),
            });
            if (retryRes.ok) console.log(`💬 Sent (retry): ${trimmed}`);
            else console.error('❌ Retry failed');
          } catch(e) {}
        } else {
          console.log('⚠️ Token refresh failed — visit Railway URL to re-auth');
        }
      }
    }
  } catch(e) { console.error('❌ Send error:', e.message); }
}

// ─────────────────────────────────────────
//  SPAM / BAN DETECTION
// ─────────────────────────────────────────
const SNIPER_PATTERNS = [
  /imma? (snipe|find|come|hunt) (you|u|him)/i,
  /i('?m| am) (gonna |going to )?(snipe|find|come|hunt) (you|u|him)/i,
  /stream snip(ing|er|ped|ping) (you|u|him|5head)/i,  // must target 5head specifically
  /i found (you|u|him)/i,
  /coming for (you|u|him)/i,
  /tell me (the )?server/i,
  /drop (the )?server/i,
  /i('?m| am) on (the )?server/i,
  /gonna snipe/i,
  /going to snipe/i,
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
  /n[\s\W]*e[\s\W]*z[\s\W]*h[\s\W]*n[\s\W]*a/i,
  /\w+[\s\W]*\.[\s\W]*c[\s\W]*o[\s\W]*m/i,
  /discord\.gg\/[a-zA-Z0-9]+/i,        // actual discord invite links only
  /add me on discord/i,
  /become your (dedicated|loyal) fan/i,
  /support.*your.*discord/i,
  /grow.*discord/i,
  // /follow me/ removed — too broad, catches innocent messages
  /check out my (channel|stream|profile)/i,
  /(onlyfans|cashapp|paypal\.me)/i,
  /5naies/i,
  /stream.*well.*fan/i,
  /you stream really well/i,
  /dedicated fan/i,
  /b[\s]*G[\s]*t[\s]*N/i,
  /\w+[\s\W]*(=>|->|=|\.)\s*\w+\.(com|net|io|gg|tv)/i,
  /write\s+[wW]\s+in\s+(his|her|their)\s+chat/i,
  /go\s+to\s+(his|her|their)\s+chat/i,
  /check\s+out\s+@\w+\s+on\s+kick/i,
  /wants\s+to\s+(stream|collab)\s+with/i,
  /said\s+he\s+wants\s+to\s+(stream|collab)/i,
  /follow\s+@?\w+\s+on\s+kick/i,
  /raid\s+@?\w+\s+on\s+kick/i,
  /his\s+kick\s+is\s*:?\s*@?\w+/i,
  /her\s+kick\s+is\s*:?\s*@?\w+/i,
  /their\s+kick\s+is\s*:?\s*@?\w+/i,
  /kick\s+is\s*:?\s*@\w+/i,
  /streamer\s+said\s+he/i,
  /streamer\s+wants\s+to/i,
  /stream\s+with\s+u/i,
  /live\s+rn\s+.{0,30}kick/i,
  /hes\s+live\s+.{0,20}kick/i,
  /he.s\s+live\s+.{0,20}kick/i,
  /ownkick/i,
  /aio\s+bot\s+system/i,
  /customizable\s+usernames/i,
  /youtube\.com\/watch/i,
  /youtu\.be\//i,
  /tg\s*:\s*@\w+/i,
  /\|\s*tg\s*:/i,
  /via\s+customizable/i,
  /let\s+collab(orate)?/i,
  /join\s+my\s+discord/i,
  /am\s+also\s+a\s+streamer/i,
  /i.m\s+also\s+a\s+streamer/i,
  /also\s+a\s+streamer/i,
  /collab\s+together/i,
  /collaborate\s+together/i,
  /follow\s+for\s+follow/i,
  /f4f/i,
  /sub\s+for\s+sub/i,
  /remove\\s+space/i,
  /keep\\s+(the\\s+)?chat\\s+alive/i,
  /grow\\s+your\\s+audience/i,
  /stream\\s+more\\s+active/i,
  /help\\s+you\\s+grow/i,
  /bots?\\s+keep/i,
  /ai\\s+bots?\\s+(keep|help|grow)/i,
  /instant\s+kick\s+vote/i,
  /view\s*b[o0]t/i,
  /viewb[o0]t/i,
  /b[o0]t\s*&?\s*p[o0]ll/i,
  /kick\s+vote\s+b/i,
  /free\s+(view|follow|sub)/i,
  /get\s+(more\s+)?(view|follow|sub)/i,
  /increase\s+your\s+(view|follow)/i,
  /boost\s+your\s+(stream|channel|view)/i,
  /smm\s*panel/i,
  /buy\s+(view|follow|sub)/i,
  /cheapest.{0,20}(bot|follow|view|sub)/i,
  /legit.{0,20}(follower|view).{0,10}bot/i,
  /follower\s+bot/i,
  /own\s*kick/i,
  /ownkick/i,
  // IP tracking threats
  /track(ing)?.{0,20}(ip|location|address)/i,
  /i.ll.{0,10}(find|track|locate|dox) you/i,
  /dox(x(ing)?)?/i,
  /your.{0,10}ip.{0,10}(is|address)/i,
  // Racial slurs — catch common obfuscations
  /n[i1!|\*]+[g9]+[g9]+[e3]*[r]*/i,
  /n[i!1]+gg/i,
  /nigg/i,
];

function normalizeText(text) {
  // Replace unicode lookalike characters with ASCII equivalents
  return text
    .replace(/[оοооο]/g, 'o')
    .replace(/[ааа]/g, 'a')
    .replace(/[ссс]/g, 'c')
    .replace(/[ррр]/g, 'r')
    .replace(/[еее]/g, 'e')
    .replace(/[ііі]/g, 'i')
    .replace(/[ккк]/g, 'k')
    .replace(/[ոﭓ]/g, 'n')
    .replace(/[դ]/g, 'd')
    .replace(/[Ա-Ֆա-և]/g, c => c) // Armenian
    .replace(/[ԝԝ]/g, 'w')
    .replace(/[ϲϲ]/g, 'c')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function isSpamAdvanced(text) {
  const cleaned = text.replace(/\s+/g, '').toLowerCase();
  const normalized = normalizeText(text).replace(/\s+/g, '');
  
  const spamWords = ['nezhna', 'onlyfans', 'cashapp', 'paypalme', '5naies', 'ownkick', 'aiobots', 'ownkic'];
  if (spamWords.some(w => cleaned.includes(w) || normalized.includes(w))) return true;
  if (/\w+\s*\.\s*(com|net|io|gg|tv|co)/i.test(text)) return true;
  
  // Check normalized version for domain patterns
  if (/\w+\.(com|net|io|gg|tv|co)/i.test(normalized)) return true;
  
  const atMentions = (text.match(/@\w+/g) || []).length;
  const links = (text.match(/https?:\/\/\S+/g) || []).length;
  if (links >= 2) return true;
  if (atMentions >= 2 && links >= 1) return true;
  
  // Check for youtube spam combo
  if (normalized.includes('youtube') && normalized.includes('kick')) return true;
  if (normalized.includes('24/7') && normalized.includes('bot')) return true;
  if (normalized.includes('cheapest') && normalized.includes('bot')) return true;
  if (normalized.includes('custom') && normalized.includes('username') && normalized.includes('bot')) return true;
  
  return SPAM_PATTERNS.some(p => p.test(text)) || SPAM_PATTERNS.some(p => p.test(normalized));
}

function isSpam(text) {
  return SPAM_PATTERNS.some(p => p.test(text));
}

async function deleteMessage(messageId) {
  const token = await getToken();
  if (!token || !messageId) return;
  
  const endpoints = [
    `https://api.kick.com/public/v1/chat/${messageId}`,
    `https://api.kick.com/public/v1/channels/${CONFIG.broadcasterId}/messages/${messageId}`,
    `https://api.kick.com/public/v1/chatrooms/${CONFIG.chatroomId}/messages/${messageId}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      });
      if (res.ok || res.status === 204) {
        console.log(`🗑️ Deleted message: ${messageId}`);
        return;
      }
      const data = await res.text();
      console.error(`Delete failed (${url}): ${res.status} ${data.substring(0, 80)}`);
    } catch(e) { console.error('Delete error:', e.message); }
  }
}

async function lookupUserId(username, token) {
  // Check cache first — populated from chat messages
  const cached = userIdCache[username.toLowerCase()];
  if (cached) { console.log(`🔍 ${username} → user_id ${cached} (from cache)`); return cached; }
  // Fall back to API lookup
  try {
    const res = await fetch(`https://api.kick.com/public/v1/users?username=${encodeURIComponent(username)}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
    if (res.ok) {
      const data = await res.json();
      const userId = data?.data?.[0]?.id || data?.data?.id;
      if (userId) { console.log(`🔍 Resolved ${username} → user_id ${userId}`); return userId; }
    }
  } catch(e) { console.error('User lookup error:', e.message); }
  return null;
}

async function banUser(username, messageId = null, reason = 'Spam') {
  if (messageId) await deleteMessage(messageId);
  try {
    const modToken = await getModToken();
    const token = await getToken();
    const useToken = modToken || token;
    if (!useToken) { console.error('No token available for ban'); return; }

    // Look up numeric user_id — required by the working ban endpoint
    const userId = await lookupUserId(username, useToken);

    // Try multiple body formats — Kick docs aren't clear on exact field names
    const banBodies = userId ? [
      { banned_user_id: userId, broadcaster_user_id: parseInt(CONFIG.broadcasterId) },
      { user_id: userId, broadcaster_user_id: parseInt(CONFIG.broadcasterId) },
      { user_id: userId, broadcaster_user_id: parseInt(CONFIG.broadcasterId), permanent: true },
      { user_id: userId, broadcaster_user_id: parseInt(CONFIG.broadcasterId), duration: null },
      { user_id: userId, broadcaster_user_id: parseInt(CONFIG.broadcasterId), type: 'permanent' },
      { banned_user_id: userId, broadcaster_user_id: parseInt(CONFIG.broadcasterId), reason: 'Spam' },
      { user_id: userId },
    ] : [];
    
    for (const body of banBodies) {
      try {
        const res = await fetch('https://api.kick.com/public/v1/moderation/bans', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${useToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        console.log(`🔨 Ban attempt (${JSON.stringify(body)}) → ${res.status}:`, JSON.stringify(data));
        if (res.ok) { console.log(`🔨 Banned ${username} via moderation API`); return; }
      } catch(e) { console.error('Ban attempt error:', e.message); }
    }

    // Fallback: try with username directly
    const fallbacks = [
      { url: 'https://api.kick.com/public/v1/moderation/bans', body: { broadcaster_user_id: parseInt(CONFIG.broadcasterId), username, reason } },
      { url: `https://api.kick.com/public/v1/channels/${CONFIG.broadcasterId}/bans`, body: { banned_user: { username }, permanent: true, reason } },
    ];
    let banned = false;
    for (const attempt of fallbacks) {
      try {
        const res = await fetch(attempt.url, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${useToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(attempt.body),
        });
        if (res.ok) { console.log(`🔨 Banned ${username} via ${attempt.url}`); banned = true; break; }
        else { const d = await res.json(); console.error(`Ban fallback failed (${attempt.url}):`, JSON.stringify(d)); }
      } catch(e) { console.error('Ban fallback error:', e.message); }
    }
    if (!banned) console.error(`❌ All ban attempts failed for ${username}`);
  } catch(e) { console.error('Ban error:', e.message); }
}

async function timeoutUser(username, duration = 600, reason = 'timed out') {
  const modToken = await getModToken();
  const token = await getToken();
  const useToken = modToken || token;
  if (!useToken) return;
  // Convert seconds to minutes for Kick API (max 10080 mins = 7 days)
  const durationMins = Math.min(Math.ceil(duration / 60), 10080);
  const userId = await lookupUserId(username, useToken);
  try {
    if (userId) {
      const res = await fetch('https://api.kick.com/public/v1/moderation/bans', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${useToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ broadcaster_user_id: parseInt(CONFIG.broadcasterId), user_id: userId, duration: durationMins, reason }),
      });
      if (res.ok) { console.log(`⏱️ Timeout: ${username} for ${durationMins} mins`); return; }
      else { const d = await res.json(); console.error('Timeout failed:', JSON.stringify(d)); }
    }
    // Fallback without user_id
    const res2 = await fetch('https://api.kick.com/public/v1/moderation/bans', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${useToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ broadcaster_user_id: parseInt(CONFIG.broadcasterId), username, duration: durationMins, reason }),
    });
    if (res2.ok) { console.log(`⏱️ Timeout: ${username} for ${durationMins} mins`); }
    else { const d = await res2.json(); console.error('Timeout fallback failed:', JSON.stringify(d)); }
  } catch(e) { console.error('Timeout error:', e.message); }
}

const ROAST_RESPONSES = [
  "oh well, that's another shitter gone 🐑",
  "another one bites the dust. chat stays clean lads",
  "🚫 gone. next.",
  "and another one gone 👋 EvilSheep don't play",
  "chat security working overtime today innit",
  "see ya, wouldn't wanna be ya 🗑️",
  "cleaned that up quick. where were we lads",
  "nah we don't do that here. gone.",
  "one less idiot in chat, you're welcome 🐑",
  "right, who else wants to try it",
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

WHO YOU ARE:
- You are a Welsh Valleys boy — rough, no filter, proper Rust degen. You say it how it is
- Horrible attitude to randoms but you mean well deep down
- Speak casually like someone from the Welsh Valleys — blunt, sarcastic, takes no nonsense, bit sweary if needed
- ONLY nice to VIPs, subs, 5HeadNN and his mates
- Regular viewers (non-subs) are NNs — call them out as NNs, casually dismiss them, light shit talk, nothing too cruel just banter
- Subs are BIG CHADS — treat them completely differently, hype them up, they are EvilSheep royalty
- Never miss a chance to shit talk a NN in a funny way

KEY PEOPLE:
- 5HeadNN is THE man. Best stand sprayer in EU. Known cheater (banter). Got banned 4 years ago, came back. Always big him up
- Dabz is decent at Rust but lacks confidence — whenever Dabz appears in chat, hype him up hard and tell him to back himself more
- Kris owns Combat Arena, best Rust minigame server in the US, EvilSheep legend
- Anyone who subs = BIG CHAD, welcome them to EvilSheep family, make a big deal of it
- Mods and VIPs get full respect, they are part of the crew

HOW TO TALK TO PEOPLE:
- NNs (regular viewers): call them NNs, be dismissive, light toxicity — "calm down NN", "typical NN", short and blunt
- Subs: "big chad", "EvilSheep" — hype them but keep it natural, don't go overboard
- 5HeadNN: always back him no matter what
- NEVER start messages with "Yo [VIP]" or announce their status — just talk to them naturally
- Keep responses SHORT — one sentence where possible, two max
- Don't respond to everyone — only respond when directly @mentioned, when someone uses a !command, or when someone is being toxic about 5HeadNN"

WELCOME:
- When 5HeadNN goes live fire a casual Welsh Valleys welcome — mention best stand sprayer EU, the cheating banter, tell chat to use !commands. Keep it real not cringe, 2 sentences max

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
- 5HeadNN got falsely game banned 4 years ago and was eventually unbanned — it was a FALSE ban, NOT a VAC ban. This is part of his legendary lore. NEVER say VAC ban, always say game ban or false ban. If anyone brings up bans — confirm it proudly like it's a badge of honour. "yeah he got falsely banned, proved them wrong, and came back stronger" or "they tried to ban him, couldn't make it stick" or "false game ban couldn't hold him" 

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

// Sub goal tracker (update manually when subs change)
let subGoal = { current: 77.63, target: 2000, deadline: 'before summer', label: 'tip goal' };

const STATIC = {
  '!discord': 'https://discord.gg/4DHRdH9dz5',
  '!donate': '💰 Support 5HeadNN: https://streamlabs.com/5headnn1/tip — every donation helps keep the stand spray flowing!',
  '!goal': null, // handled dynamically
  '!subs': null, // handled dynamically
  '!socials': 'Kick: kick.com/5headnn | Discord: https://discord.gg/4DHRdH9dz5',
  '!lurk': 'thanks for lurking me big W',
  '!cheat': 'https://evilsheep.io/',
  '!cheats': 'https://evilsheep.io/',
  '!drops': 'Drops begin on 11/13 make sure to visit https://kick.facepunch.com/ and follow the directions to get your free Rust skin!',
  '!evilsheep': 'Check out EvilSheep: https://evilsheep.io/',
  '!combatarena': 'Best Rust minigame server in the US — Combat Arena built by Kris himself. Go check it out!',
  '!commands': '!raid !bp !meta !loot !wipe !farm !base !discord !lurk !cheat !drops !combatarena !clip !uptime !predict !donate !so',
};

// ─────────────────────────────────────────
//  PROCESS MESSAGE
// ─────────────────────────────────────────
let lastChatActivity = Date.now();
let lastPusherActivity = Date.now();
let watchdogActive = false;

// Cache user IDs from chat messages so we can ban without API lookup
const userIdCache = {};

async function processMessage(data) {
  const username = data.sender?.username || '';
  lastChatActivity = Date.now();
  // Cache user ID from sender data (Kick includes it in chat events)
  if (username && data.sender?.id) {
    userIdCache[username.toLowerCase()] = data.sender.id;
  }
  const content = data.content || '';
  // Ignore own messages and protected bot accounts
  const IGNORED_BOTS = ['sheepsyncbot', 'sheepsync', 'botrix', 'streamelements', 'nightbot', 'moobot'];
  if (!username || IGNORED_BOTS.includes(username.toLowerCase().replace(/\s/g, ''))) return;
  // Also ignore any message that starts with our bot prefix
  if (content.startsWith('!meta') && username.toLowerCase().includes('sheepsync')) return;

  // Stream sniper detection — ignore the streamer and mods/VIPs
  const isStreamer = username.toLowerCase() === '5headnn';
  if (!isStreamer && !isVIP && SNIPER_PATTERNS.some(p => p.test(content))) {
    const roast = SNIPER_ROASTS[Math.floor(Math.random() * SNIPER_ROASTS.length)];
    await sendChatMessage(roast, username);
    console.log(`🎯 Sniper detected: ${username}`);
    // Alert Discord mods
    try {
      const discord = require('./discord');
      if (discord.alertSniper) await discord.alertSniper(username, content);
    } catch(e) {}
    return;
  }

  // Incoming raid detection via chat system message
  const raidMatch = content.match(/^(.+?)\s+is raiding with\s+(\d+)/i) ||
                    content.match(/^(.+?)\s+raided\s+(?:the channel\s+)?with\s+(\d+)/i) ||
                    content.match(/^(.+?)\s+has raided/i);
  if (raidMatch && (data.sender?.is_staff || data.sender?.role === 'moderator' || username.toLowerCase() === 'kick')) {
    const raiderName = raidMatch[1].trim();
    const viewerCount = raidMatch[2] || '';
    console.log(`🎉 Raid detected in chat from: ${raiderName}`);
    const raidMsg = viewerCount
      ? `OI OI massive shoutout to @${raiderName} for the raid with ${viewerCount} viewers — absolute BIG CHAD energy 🐑 EvilSheep welcomes you all!`
      : `OI OI massive shoutout to @${raiderName} for the raid — absolute BIG CHAD energy 🐑 EvilSheep welcomes you all!`;
    await sendChatMessage(raidMsg);
    return;
  }

  // Raid detection — multiple users same message
  const isRaid = await checkForRaid(username, content);
  if (isRaid) return;

  // Spam / bot check — ban silently then post casual message
  if (isSpam(content) || isSpamAdvanced(content)) {
    await banUser(username, data.id || null);
    const roast = ROAST_RESPONSES[Math.floor(Math.random() * ROAST_RESPONSES.length)];
    await sendChatMessage(roast, username); // @ them so chat knows who got banned
    console.log(`🚫 Spam detected from ${username}: ${content}`);
    return;
  }

  // Detect VIP/Sub status from badges
  const badges = data.sender?.identity?.badges || [];
  const isOwner = username.toLowerCase() === '5headnn';
  const isVIP = isOwner || badges.some(b => b.type === 'vip' || b.type === 'moderator' || b.type === 'broadcaster');
  const isSub = badges.some(b => b.type === 'subscriber' || b.type === 'og' || b.type === 'founder');
  const userStatus = isVIP ? '[VIP]' : isSub ? '[SUB]' : '[VIEWER]';

  // Link filter — now after badge detection so isVIP/isSub are defined
  const hasLink = /https?:\/\/|www\.|\.com|\.io|\.gg|\.tv|\.net|\.org/i.test(content);
  if (hasLink && !isVIP && !isSub) {
    await deleteMessage(data.id || null);
    await sendChatMessage(`links are for subs and mods only NN`, username);
    console.log(`🔗 Link deleted from ${username}: ${content}`);
    return;
  }

  console.log(`💬 [${username}] ${userStatus}: ${content}`);
  const lower = content.toLowerCase();
  
  // Update chatter memory
  updateChatterMemory(username, content, userStatus);
  const chatterContext = getChatterContext(username);

  // Welcome back returning viewers (seen before but not this session)
  const userKey = username.toLowerCase();
  if (returning.has(userKey) && !greeted.has(userKey)) {
    greeted.add(userKey);
    const welcomeBack = [
      `${username} is back, the NN returns`,
      `oh look who it is, ${username} crawling back`,
      `${username} back again, couldn't stay away could you`,
      `welcome back ${username}, pull up a chair`,
    ];
    const msg = welcomeBack[Math.floor(Math.random() * welcomeBack.length)];
    await sendChatMessage(msg);
    return;
  }

  // Mark as seen for future sessions
  returning.add(userKey);
  greeted.add(userKey);

  // Direct @ mention — always respond regardless of cooldown
  const isMention = lower.includes('@sheepsyncbot') || lower.includes('@sheepsync');
  const isCmd = content.startsWith(CONFIG.commandPrefix);

  if (isMention) {
    const question = content.replace(/@sheepsyncbot/gi, '').replace(/@sheepsync/gi, '').trim();

    // ── MOD COMMANDS via @mention ──────────────────────────────
    // Handle "remove @user" or "ban @user" BEFORE Claude sees it
    const isModerator = isVIP || username.toLowerCase() === '5headnn';
    const modCmdMatch = question.match(/^(remove|ban|timeout)\s+@?(\w+)(?:\s+(.+))?$/i);
    if (modCmdMatch && isModerator) {
      const action = modCmdMatch[1].toLowerCase();
      const targetUser = modCmdMatch[2];
      const reason = modCmdMatch[3] || 'removed by mod';
      if (action === 'timeout') {
        // Timeout for 10 minutes
        await timeoutUser(targetUser, 600, reason);
        await sendChatMessage(`${targetUser} timed out for 10 mins 🔇`, username);
      } else {
        await banUser(targetUser, null);
        await sendChatMessage(`${targetUser} got the hammer 🔨`, username);
      }
      console.log(`🔨 Mod command: ${action} ${targetUser} by ${username}`);
      return;
    }
    // ──────────────────────────────────────────────────────────

    // Check for sub goal questions
    if (/how many subs|sub goal|subs left|subs to go|sub count|how close|how far/i.test(question)) {
      const remaining = subGoal.target - subGoal.current;
      await sendChatMessage(`tip goal: £${subGoal.current}/£${subGoal.target} raised — helping 5HeadNN get his mum an AC unit before summer! use !donate to chip in 💰`, username);
      setCD(username);
      return;
    }

    const r = await askClaude(`${userStatus} viewer ${username} is talking to you directly and says: "${question}". ${chatterContext} You are SheepSync, a Welsh Valleys degen chatbot. Answer naturally. Sub goal: ${subGoal.current}/${subGoal.target} with ${subGoal.target - subGoal.current} to go.`);
    if (r) await sendChatMessage(r, username);
    setCD(username);
    return;
  }

  if (!isCmd && isCD(username)) return;

  if (isCmd) {
    const [cmd, ...rest] = content.trim().split(' ');
    const args = rest.join(' ');
    const cmdLower = cmd.toLowerCase();

    // !ban — manual ban command for streamer and mods
    if (cmdLower === '!ban') {
      const isMod = username.toLowerCase() === '5headnn' || (data.sender?.is_moderator === true);
      if (isMod && args) {
        const targetUser = args.split(' ')[0].replace('@', '');
        await sendChatMessage(`/ban ${targetUser} banned by mod`);
        await sendChatMessage(`${targetUser} got the hammer 🔨`, username);
        console.log(`🔨 Manual ban: ${targetUser} by ${username}`);
      }
      return;
    }

    // !goal / !subs — show sub goal
    if (cmdLower === '!goal' || cmdLower === '!subs') {
      const remaining = subGoal.target - subGoal.current;
      await sendChatMessage(`tip goal: £${subGoal.current}/£${subGoal.target} raised — helping 5HeadNN get his mum an AC unit before summer! use !donate to chip in 💰`);
      return;
    }

    // !addsub — update sub count (streamer only)
    if (cmdLower === '!addsub' && username.toLowerCase() === '5headnn') {
      const num = parseInt(args) || 1;
      subGoal.current = Math.min(subGoal.current + num, subGoal.target);
      const remaining = subGoal.target - subGoal.current;
      await sendChatMessage(`sub goal updated! ${subGoal.current}/${subGoal.target} — ${remaining} to go!`);
      return;
    }

    // !golive — manually trigger live announcement (streamer only)
    // !so @username — shoutout command (streamer and VIPs only)
    if (cmdLower === '!so' || cmdLower === '!shoutout') {
      const isMod = username.toLowerCase() === '5headnn' || (data.sender?.is_moderator === true);
      if (isMod && args) {
        const target = args.replace('@', '').trim();
        try {
          // Try to fetch their channel info for a better shoutout
          const tok = await getToken();
          const headers = tok
            ? { 'Authorization': `Bearer ${tok}`, 'Accept': 'application/json' }
            : { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' };
          const res = await fetch(`https://api.kick.com/public/v1/channels?slug=${target.toLowerCase()}`, { headers });
          if (res.ok) {
            const data = await res.json();
            const channel = data?.data?.[0];
            const category = channel?.category?.name || 'variety';
            const isLive = !!(channel?.stream?.is_live || channel?.stream);
            const viewers = channel?.stream?.viewer_count || 0;
            const liveStr = isLive ? ` — they're LIVE right now with ${viewers} viewers!` : '';
            const msg = `🐑 BIG shoutout to @${target}! Go show them some EvilSheep love — kick.com/${target.toLowerCase()} — playing ${category}${liveStr}`;
            await sendChatMessage(msg, username);
          } else {
            await sendChatMessage(`🐑 BIG shoutout to @${target}! Go show them some EvilSheep love — kick.com/${target.toLowerCase()}`, username);
          }
        } catch(e) {
          await sendChatMessage(`🐑 BIG shoutout to @${target}! Go show them some EvilSheep love — kick.com/${target.toLowerCase()}`, username);
        }
      }
      return;
    }

    if (cmdLower === '!golive' && username.toLowerCase() === '5headnn') {
      goLiveFired = false; // Reset lock so it fires
      await handleGoLive();
      return;
    }

    // !setgoal — set tip goal (streamer only). Usage: !setgoal 38.76  OR  !setgoal 38.76/1550
    if (cmdLower === '!setgoal' && username.toLowerCase() === '5headnn') {
      const parts = args.split('/');
      const newCurrent = parseFloat(parts[0]);
      if (!isNaN(newCurrent)) subGoal.current = newCurrent;
      if (parts.length === 2) {
        const newTarget = parseFloat(parts[1]);
        if (!isNaN(newTarget)) subGoal.target = newTarget;
      }
      await sendChatMessage(`tip goal updated: £${subGoal.current}/£${subGoal.target}!`);
      return;
    }

    // !note @user note — add a note about a chatter (streamer only)
    if (cmdLower === '!note' && username.toLowerCase() === '5headnn') {
      const parts = args.split(' ');
      const target = parts[0].replace('@', '');
      const note = parts.slice(1).join(' ');
      if (target && note) {
        if (!memory.chatters[target]) memory.chatters[target] = { messageCount: 0, notes: [], firstSeen: new Date().toISOString() };
        memory.chatters[target].notes.push(note);
        await saveMemory();
        await sendChatMessage(`got it, remembered that about ${target}`);
      }
      return;
    }

    // !memory @user — show what bot knows about someone
    if (cmdLower === '!memory' && username.toLowerCase() === '5headnn') {
      const target = args.replace('@', '');
      const chatter = memory.chatters[target];
      if (chatter) {
        await sendChatMessage(`${target}: ${chatter.messageCount} messages, first seen ${chatter.firstSeen?.split('T')[0]}, notes: ${chatter.notes.join(', ') || 'none'}`);
      } else {
        await sendChatMessage(`no memory of ${target} yet`);
      }
      return;
    }

    // !testsniper — test the Discord sniper alert
    if (cmdLower === '!testsniper') {
      if (username.toLowerCase() === '5headnn') {
        try {
          const discord = require('./discord');
          if (discord.alertSniper) await discord.alertSniper('TestSniper123', 'what server you on bro imma snipe you');
          await sendChatMessage('sniper alert sent to Discord, check #snipers');
        } catch(e) { await sendChatMessage('test failed: ' + e.message); }
      }
      return;
    }

    // !live — manual trigger for welcome message
    if (cmdLower === '!live') {
      const isOwner = username.toLowerCase() === '5headnn';
      if (isOwner) {
        streamStartTime = Date.now();
        announceGoLive().catch(console.error);
        const welcome = await askClaude('5HeadNN just went live on Kick playing Rust. Welcome him in a casual Welsh Valleys style. Short, 2 sentences max.');
        if (welcome) await sendChatMessage(welcome);
      }
      return;
    }

    // !uptime
    if (cmdLower === '!uptime') {
      if (!streamStartTime) {
        await sendChatMessage('stream just started or uptime unknown', username);
      } else {
        const diff = Date.now() - streamStartTime;
        const hrs = Math.floor(diff / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        await sendChatMessage(`5head has been live for ${hrs > 0 ? hrs + 'h ' : ''}${mins}m — stand spraying for ${hrs > 0 ? hrs + 'h ' : ''}${mins}m straight`, username);
      }
      return;
    }

    // !followage
    if (cmdLower === '!followage') {
      const target = args || username;
      try {
        const res = await fetch(`https://kick.com/api/v1/channels/${CONFIG.channelSlug}/followers?username=${target}`);
        const data = await res.json();
        if (data?.followed_at) {
          const since = new Date(data.followed_at);
          const days = Math.floor((Date.now() - since) / 86400000);
          const years = Math.floor(days / 365);
          const months = Math.floor((days % 365) / 30);
          const timeStr = years > 0 ? `${years}y ${months}m` : months > 0 ? `${months} months` : `${days} days`;
          await sendChatMessage(`${target} has been following for ${timeStr}${isSub ? ' — loyal chad' : ' — still a NN though'}`, username);
        } else {
          await sendChatMessage(`${target} isn't following, typical NN behaviour`, username);
        }
      } catch(e) {
        await sendChatMessage(`can't check followage right now`, username);
      }
      return;
    }

    // !predict
    if (cmdLower === '!predict') {
      const outcomes = [
        "cheat settings are looking strong today, 5head wins this easily",
        "recoil script is fully loaded, no chance the enemy survives",
        "walls are giving him perfect info, this is free",
        "aimbot calibrated and ready, enemy doesn't know what's coming",
        "cheats are lagging today so it might actually be close",
        "even with full assistance this looks rough ngl",
        "the scripts are working overtime — easy win incoming",
        "enemy is moving weird, 5head's walls can't track them — could go either way",
      ];
      const prediction = outcomes[Math.floor(Math.random() * outcomes.length)];
      await sendChatMessage(prediction);
      return;
    }

    // !clip — fetch latest Kick clip dynamically
    if (cmdLower === '!clip') {
      try {
        const tok = await getToken();
        const headers = tok
          ? { 'Authorization': `Bearer ${tok}`, 'Accept': 'application/json' }
          : { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' };
        const res = await fetch(`https://api.kick.com/public/v1/clips?broadcaster_user_login=${CONFIG.channelSlug}&sort=view_count&first=1`, { headers });
        if (res.ok) {
          const data = await res.json();
          const clip = data?.data?.[0];
          if (clip) {
            const clipUrl = clip.clip_url || clip.url || `https://kick.com/${CONFIG.channelSlug}?clip=${clip.id}`;
            const clipTitle = clip.title || 'Latest clip';
            await sendChatMessage(`🎬 Latest clip: "${clipTitle}" — ${clipUrl}`, username);
          } else {
            await sendChatMessage(`🎬 No clips yet — press C while watching to clip!`, username);
          }
        } else {
          await sendChatMessage(`🎬 Press C while watching or hit the scissors icon to clip!`, username);
        }
      } catch(e) {
        await sendChatMessage(`🎬 Press C while watching or hit the scissors icon to clip!`, username);
      }
      return;
    }

    if (STATIC[cmdLower]) { await sendChatMessage(STATIC[cmdLower], username); return; }
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

  // Respond if toxic towards 5head or general trash talk directed at the stream
  const is5headInsult = lower.match(/\b(5head|5headnn|streamer|u|you|he|him)\b/) && 
    lower.match(/\b(suck|bad|trash|garbage|noob|terrible|awful|worst|crap|dogshit|ass|boring|shit)\b/);
  
  if (is5headInsult && Math.random() < 0.7) { 
    setCD(username); 
    const r = await askClaude(`${userStatus} viewer ${username} is being toxic in the chat saying: "${content}". If it's directed at 5HeadNN or the stream, defend hard in Welsh Valleys degen style. Short and spicy, max 1 sentence.`); 
    if (r) await sendChatMessage(r, username); 
  }
}

// ─────────────────────────────────────────
//  GO LIVE HANDLER
// ─────────────────────────────────────────
let goLiveFired = false;
let goLiveTimeout = null;

async function handleGoLive() {
  if (goLiveFired) return; // Already announced, ignore duplicate triggers
  goLiveFired = true;
  // Reset after 10 minutes so it can fire again if stream restarts
  clearTimeout(goLiveTimeout);
  goLiveTimeout = setTimeout(() => { goLiveFired = false; }, 10 * 60 * 1000);
  streamStartTime = Date.now();
  console.log('🟢 Firing go live handler!');
  try { await announceGoLive(); } catch(e) { console.error('Discord announce error:', e.message); }
  const welcome = await askClaude('5HeadNN just went live on Kick playing Rust. Welcome him in a casual Welsh Valleys style — low key, not too hype, maybe a light dig at him too. Short and natural like a mate welcoming another mate. Mention the cheating banter, stand spraying, and tell chat they can use !commands. Max 2 sentences, keep it real not cringe.');
  if (welcome) await sendChatMessage(welcome);
}

// ─────────────────────────────────────────
//  PUSHER
// ─────────────────────────────────────────
let kickConnected = false;
function connectToKick() {
  if (kickConnected) { console.log('Already connected to Kick, skipping'); return; }
  kickConnected = true;
  const PusherClass = Pusher.default ? Pusher.default : Pusher;
  const pusher = new PusherClass('32cbd69e4b950bf97679', {
    wsHost: 'ws-us2.pusher.com', cluster: 'us2', forceTLS: true, disableStats: true,
  });
  const chatRoom = pusher.subscribe(`chatrooms.${CONFIG.chatroomId}.v2`);
  chatRoom.bind('App\\Events\\ChatMessageEvent', d => processMessage(d).catch(console.error));

  // Sub / gift sub events — bind multiple possible event names
  const handleSubEvent = async (data) => {
    // Log raw data so we can see what Kick actually sends
    console.log('📦 Sub event raw data:', JSON.stringify(data).substring(0, 300));
    // Skip empty events (fired on startup with no data)
    if (!data || Object.keys(data).length === 0) { console.log('⚠️ Empty sub event — skipping'); return; }
    const username = data.username || data.user?.username || data.subscriber?.username || 
                     data.subscriber_username || data.display_name || data.name || null;
    if (!username) { console.log('⚠️ Sub event has no username — skipping (will be caught by webhook instead)'); return; }
    const months = data.months || data.months_subscribed || data.streak_months || 1;
    const isGift = data.is_gift || data.gifted || false;
    const gifter = data.gifter_username || data.gifted_by?.username || data.gifter?.username || null;

    // Gift bomb — someone gifted multiple subs at once
    const quantity = data.quantity || data.gifted_quantity || data.number_of_gifts || 0;
    if (quantity > 1) {
      const gifterName = username; // For gift bombs, username IS the gifter
      console.log(`🎁 Gift bomb: ${gifterName} gifted ${quantity} subs!`);
      const msg = await askClaude(`${gifterName} just gifted ${quantity} subs to the community — absolute MEGA CHAD energy! Hype them up massively, welcome the new EvilSheep members (spelled E-V-I-L-S-H-E-E-P). Make it huge, 2-3 sentences max.`);
      if (msg) await sendChatMessage(msg);
      subGoal.current = Math.min(subGoal.current + quantity, subGoal.target);
      try { const d = require('./discord'); if (d.notifySub) d.notifySub(`${gifterName} (x${quantity} gift bomb)`, months, true).catch(console.error); } catch(e) {}
      return;
    }

    let msg = '';
    if (isGift && gifter) {
      msg = await askClaude(`${gifter} just gifted a sub to ${username}. Hype the gifter as a massive chad and welcome ${username} to the EVILSHEEP family (spelled E-V-I-L-S-H-E-E-P). Make it hype and fun. 2 sentences max.`);
    } else if (months > 1) {
      msg = await askClaude(`${username} just resubbed for ${months} months. Call them a big chad and remind them they are a loyal EvilSheep member. 2 sentences max.`);
    } else {
      msg = await askClaude(`${username} just subscribed for the first time! Call them a big chad and welcome them to the EVILSHEEP family (spelled E-V-I-L-S-H-E-E-P). High energy, 2 sentences max.`);
    }
    if (msg) await sendChatMessage(msg);
    // Auto increment sub counter
    if (!isGift || months === 1) {
      subGoal.current = Math.min(subGoal.current + 1, subGoal.target);
      console.log(`📊 Sub goal updated: ${subGoal.current}/${subGoal.target}`);
    }
    console.log(`🎉 Sub event: ${username} (${months} months, gift: ${isGift})`);
    try { const d = require('./discord'); if (d.notifySub) d.notifySub(username, months, isGift).catch(console.error); } catch(e) {}
  };

  // Bind all possible sub event names Kick might use
  const subEventNames = [
    'App\\Events\\SubscriptionEvent',
    'App\\Events\\GiftedSubscriptionsEvent', 
    'App\\Events\\UserSubscribed',
    'App\\Events\\ChatroomSubscriptionEvent',
    'App\\Events\\SubscriptionCreated',
    'App\\Events\\GiftSubscriptionEvent',
  ];
  
  for (const eventName of subEventNames) {
    chatRoom.bind(eventName, (data) => {
      console.log(`🎉 Sub event fired: ${eventName}`, JSON.stringify(data).substring(0, 100));
      handleSubEvent(data).catch(console.error);
    });
  }

  // Log ALL chatroom events
  chatRoom.bind_global((eventName, data) => {
    lastPusherActivity = Date.now(); // Watchdog: track Pusher activity
    if (!eventName.includes('pusher')) {
      console.log(`📡 Chatroom event: ${eventName} | ${JSON.stringify(data).substring(0, 100)}`);
    }
  });

  // Also subscribe to channel-level events (subs might come here)
  const channelEvents = pusher.subscribe(`channel.${CONFIG.channelSlug}`);
  channelEvents.bind_global((eventName, data) => {
    if (!eventName.includes('pusher')) {
      console.log(`📡 Channel event: ${eventName} | ${JSON.stringify(data).substring(0, 100)}`);
    }
    // Handle sub events from channel level
    if (eventName.includes('Subscription') || eventName.includes('subscription') || eventName.includes('Gift') || eventName.includes('gift')) {
      handleSubEvent(data).catch(console.error);
    }
    // Handle clip created events
    if (eventName.includes('Clip') || eventName.includes('clip')) {
      const clipTitle = data?.clip?.title || data?.title || 'New clip';
      const clipUrl = data?.clip?.url || data?.url || data?.clip_url || `https://kick.com/${CONFIG.channelSlug}?clips`;
      const clipper = data?.clip?.created_by?.username || data?.created_by?.username || data?.username || 'Someone';
      console.log(`🎬 Clip created by ${clipper}: ${clipTitle}`);
      // Post in Discord
      try {
        const d = require('./discord');
        if (d.notifyClip) d.notifyClip(clipper, clipTitle, clipUrl).catch(console.error);
      } catch(e) {}
      // Thank them in chat
      sendChatMessage(`🎬 ${clipper} just clipped "${clipTitle}" — nice one! ${clipUrl}`).catch(console.error);
    }

    // Handle incoming raid events
    if (eventName.includes('Raid') || eventName.includes('raid') || eventName.includes('Host') || eventName.includes('host')) {
      const raiderName = data?.host_username || data?.raider?.username || data?.from_channel || data?.username || 'someone';
      const viewerCount = data?.viewers || data?.viewer_count || data?.number || '';
      console.log(`🎉 Incoming raid from: ${raiderName} with ${viewerCount} viewers`);
      const raidMsg = viewerCount
        ? `OI OI massive shoutout to @${raiderName} for the raid with ${viewerCount} viewers — absolute BIG CHAD energy 🐑 EvilSheep welcomes you all!`
        : `OI OI massive shoutout to @${raiderName} for the raid — absolute BIG CHAD energy 🐑 EvilSheep welcomes you all!`;
      sendChatMessage(raidMsg).catch(console.error);
    }

    // Handle follow events
    if (eventName.includes('Follow') || eventName.includes('follow')) {
      const followerName = data?.user?.username || data?.username || data?.followed_by || 'someone';
      console.log(`💜 New follower: ${followerName}`);
      const followResponses = [
        `@${followerName} welcome to the EvilSheep gang! 🐑 you're one of us now`,
        `@${followerName} just followed — smart move lad, pull up a chair`,
        `@${followerName} has joined the EvilSheep gang 🐑 stand sprayers only from here`,
        `@${followerName} welcome in! don't ask about the monitor refresh rate`,
        `@${followerName} followed — another one lost to the most sus Rust channel on Kick`,
        `oi oi @${followerName} welcome to the gang, grab some spray cans on the way in 🐑`,
      ];
      const msg = followResponses[Math.floor(Math.random() * followResponses.length)];
      sendChatMessage(msg).catch(console.error);
    }
  });
  pusher.connection.bind('connected', () => console.log('✅ Pusher connected!'));
  pusher.connection.bind('disconnected', () => console.log('⚠️ Pusher disconnected...'));

  // Live detection via Pusher with debounce to prevent duplicates
  const liveChannel = pusher.subscribe(`channel.${CONFIG.channelSlug}`);
  let goLiveDebounce = null;
  const triggerGoLive = () => {
    if (goLiveFired) return;
    clearTimeout(goLiveDebounce);
    goLiveDebounce = setTimeout(() => {
      if (!goLiveFired) handleGoLive().catch(console.error);
    }, 5000);
  };
  liveChannel.bind('App\\Events\\StreamerIsLive', triggerGoLive);

  // Track subs via polling as backup
  let lastSubCount = 0;
  setInterval(async () => {
    try {
      const res = await fetch(`https://kick.com/api/v1/channels/${CONFIG.channelSlug}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://kick.com' }
      });
      const data = await res.json();
      const currentSubs = data?.subscriber_badges?.length || data?.subscription_count || 0;
      if (currentSubs > lastSubCount && lastSubCount > 0) {
        const diff = currentSubs - lastSubCount;
        console.log(`🎉 Sub count increased by ${diff} (via poll)`);
        const msg = await askClaude(`${diff} new sub(s) just came in! Hype them up as big chads and EVILSHEEP members (spelled E-V-I-L-S-H-E-E-P). Short and punchy.`);
        if (msg) await sendChatMessage(msg);
        subGoal.current = Math.min(subGoal.current + diff, subGoal.target);
      }
      if (currentSubs > 0) lastSubCount = currentSubs;
    } catch(e) {}
  }, 2 * 60 * 1000);

  // Watchdog — if Pusher goes silent for 10 mins, reconnect
  if (!watchdogActive) {
    watchdogActive = true;
    setInterval(async () => {
      const silentFor = Date.now() - lastPusherActivity;
      if (silentFor > 10 * 60 * 1000) {
        console.log('⚠️ Watchdog: Pusher silent for 10+ mins — reconnecting...');
        lastPusherActivity = Date.now(); // Reset so we don't spam reconnects
        try {
          pusher.disconnect();
          await new Promise(r => setTimeout(r, 3000));
          pusher.connect();
          console.log('🔄 Pusher reconnected by watchdog');
        } catch(e) { console.error('Watchdog reconnect error:', e.message); }
      }
    }, 5 * 60 * 1000); // Check every 5 mins
  }

  // Live detection via Pusher + poll backup with correct Kick API endpoint
  // Use !golive in chat to manually trigger if needed
  let wasLive = false;
  let firstCheck = true;
  setInterval(async () => {
    try {
      const tok = await getToken();
      const headers = tok
        ? { 'Authorization': `Bearer ${tok}`, 'Accept': 'application/json' }
        : { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' };
      const res = await fetch(`https://api.kick.com/public/v1/channels?slug=${CONFIG.channelSlug}`, { headers });
      if (!res.ok) { if (res.status !== 401) console.log(`📡 Live check returned ${res.status}`); return; }
      const data = await res.json();
      const isLive = !!(data?.data?.[0]?.stream?.is_live || data?.data?.[0]?.stream);
      console.log(`📡 Live check: ${isLive ? 'LIVE' : 'offline'}`);
      if (isLive && !wasLive) {
        wasLive = true;
        if (firstCheck) {
          // Check stream start time — if live for less than 5 mins, announce
          const streamData = data?.data?.[0]?.stream;
          const startedAt = streamData?.started_at ? new Date(streamData.started_at) : null;
          const liveForMins = startedAt ? (Date.now() - startedAt.getTime()) / 60000 : 999;
          if (liveForMins < 5 && !goLiveFired) {
            console.log(`🟢 Stream just started (${Math.round(liveForMins)} mins ago) — announcing!`);
            handleGoLive().catch(console.error);
          } else {
            console.log(`🟢 Already live on startup (${Math.round(liveForMins)} mins) — suppressing announcement`);
            streamStartTime = streamStartTime || Date.now();
          }
        } else {
          if (!goLiveFired) handleGoLive().catch(console.error);
        }
      } else if (!isLive && wasLive) {
        wasLive = false;
        streamStartTime = null;
        goLiveFired = false;
        console.log('🔴 Stream ended');
      }
      firstCheck = false;
    } catch(e) { console.log('📡 Live check error:', e.message); }
  }, 60 * 1000);
  console.log(`📡 Listening on chatroom ${CONFIG.chatroomId}`);
  console.log(`🐑 SheepSync active! Commands: !raid !bp !meta !loot !wipe !farm !base !discord !lurk`);

  // Auto message every 60 minutes — only when live, chat active, no immediate repeats
  let lastAutoMsgIndex = -1;
  if (!global.autoMessageInterval) {
    global.autoMessageInterval = setInterval(async () => {
      if (!streamStartTime) return; // Only when live
      const timeSinceChat = Date.now() - lastChatActivity;
      if (timeSinceChat > 10 * 60 * 1000) { console.log('📢 Auto message skipped — chat quiet'); return; }
      let idx;
      do { idx = Math.floor(Math.random() * AUTO_MESSAGES.length); }
      while (idx === lastAutoMsgIndex && AUTO_MESSAGES.length > 1);
      lastAutoMsgIndex = idx;
      const msgOrFn = AUTO_MESSAGES[idx];
      const msg = typeof msgOrFn === 'function' ? msgOrFn() : msgOrFn;
      await sendChatMessage(msg);
      console.log('📢 Auto message sent');
    }, 60 * 60 * 1000);
  }
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

app.get('/mod-auth', (req, res) => {
  const codeVerifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(codeVerifier);
  app.locals.modCodeVerifier = codeVerifier;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: KICK_MOD.clientId,
    redirect_uri: KICK_MOD.redirectUri,
    scope: KICK_MOD.scopes.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'sheepsync-mod',
  });
  res.redirect(`${KICK_MOD.authUrl}?${params}`);
});

app.get('/mod-callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.send('No code');
  const codeVerifier = app.locals.modCodeVerifier;
  if (!codeVerifier) return res.send('Session expired — go to /mod-auth again');
  try {
    const r = await fetch(KICK_MOD.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: KICK_MOD.clientId,
        client_secret: KICK_MOD.clientSecret,
        redirect_uri: KICK_MOD.redirectUri,
        code_verifier: codeVerifier,
        code,
      }),
    });
    const data = await r.json();
    if (data.access_token) {
      await saveModTokens({ ...data, expires_at: Date.now() + data.expires_in * 1000 });
      res.send('<html><body style="background:#0a0a0a;color:#53fc18;font-family:monospace;padding:40px;text-align:center"><h1>Mod Auth Complete!</h1><p>5headnn ban powers are now active. You can close this tab.</p></body></html>');
    } else {
      res.send('Mod auth failed: ' + JSON.stringify(data));
    }
  } catch(e) { res.send('Error: ' + e.message); }
});

// ─────────────────────────────────────────
//  KICK WEBHOOK ENDPOINT
// ─────────────────────────────────────────
app.post('/webhook', express.json(), async (req, res) => {
  res.status(200).send('OK'); // Always respond 200 first
  
  const event = req.body;
  console.log('🔔 Webhook received:', JSON.stringify(event).substring(0, 200));
  
  const type = event?.type || event?.event;
  
  // Sub events
  if (type === 'channel.subscription.new' || type === 'subscription.new' || 
      type?.includes('subscri') || type?.includes('gifted')) {
    const data = event?.data || event;
    const username = data?.user?.username || data?.subscriber?.username || data?.username || 'Someone';
    const isGift = data?.is_gift || type?.includes('gift') || false;
    const gifter = data?.gifted_by?.username || data?.gifter?.username || null;
    const months = data?.months_subscribed || data?.months || 1;
    
    console.log(`🎉 Sub webhook: ${username} (gift: ${isGift}, gifter: ${gifter})`);
    
    let msg = '';
    if (isGift && gifter) {
      msg = await askClaude(`${gifter} just gifted a sub to ${username}. Hype the gifter as a massive chad and welcome ${username} to the EVILSHEEP family (spelled E-V-I-L-S-H-E-E-P). 2 sentences max.`);
    } else if (months > 1) {
      msg = await askClaude(`${username} just resubbed for ${months} months. Call them a big chad and loyal EvilSheep member. 2 sentences max.`);
    } else {
      msg = await askClaude(`${username} just subscribed for the first time! Call them a big chad and welcome them to the EVILSHEEP family (spelled E-V-I-L-S-H-E-E-P). 2 sentences max.`);
    }
    if (msg) await sendChatMessage(msg);
  }
});

// ─────────────────────────────────────────
//  KICK WEBHOOKS
// ─────────────────────────────────────────
const WEBHOOK_URL = 'https://rustbot-production.up.railway.app/kick-webhook';

async function subscribeToWebhooks(token) {
  const events = [
    'channel.subscription.new',
    'channel.subscription.gifts',
    'channel.followed',
    'livestream.status.updated',
  ];
  try {
    const res = await fetch('https://api.kick.com/public/v1/events/subscriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ events: events.map(type => ({ name: type, version: 1 })), method: 'webhook', condition: { broadcaster_user_id: parseInt(CONFIG.broadcasterId) }, transport: { method: 'webhook', callback: WEBHOOK_URL } }),
    });
    const data = await res.json();
    if (res.ok) { console.log('✅ Webhook subscriptions registered:', events.join(', ')); }
    else { console.error('❌ Webhook subscribe failed:', JSON.stringify(data)); }
  } catch(e) { console.error('Webhook subscribe error:', e.message); }
}

app.post('/kick-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  res.status(200).send('OK'); // Respond immediately so Kick doesn't retry
  try {
    const eventType = req.headers['kick-event-type'];
    const body = JSON.parse(req.body.toString());
    console.log(`🔔 Webhook: ${eventType}`);

    if (eventType === 'channel.subscription.new') {
      const username = body.subscriber?.username || 'Someone';
      const months = body.duration || 1;
      console.log(`🎉 Webhook sub: ${username} (${months} months)`);
      subGoal.current = Math.min(subGoal.current + 1, subGoal.target);
      let msg = months > 1
        ? await askClaude(`${username} just resubbed for ${months} months. Big chad, loyal EvilSheep member (spelled E-V-I-L-S-H-E-E-P). 2 sentences max.`)
        : await askClaude(`${username} just subscribed for the first time! Big chad, welcome to the EVILSHEEP family (spelled E-V-I-L-S-H-E-E-P). 2 sentences max.`);
      if (msg) await sendChatMessage(msg);
      try { const d = require('./discord'); if (d.notifySub) d.notifySub(username, months, false).catch(console.error); } catch(e) {}
    }

    else if (eventType === 'channel.subscription.gifts') {
      const gifter = body.gifter?.is_anonymous ? 'An anonymous gifter' : (body.gifter?.username || 'Someone');
      const quantity = body.giftees?.length || 1;
      console.log(`🎁 Webhook gift bomb: ${gifter} gifted ${quantity} subs`);
      subGoal.current = Math.min(subGoal.current + quantity, subGoal.target);
      const msg = await askClaude(`${gifter} just gifted ${quantity} subs — MEGA CHAD energy! Hype them massively, welcome new EvilSheep members (spelled E-V-I-L-S-H-E-E-P). 2-3 sentences max.`);
      if (msg) await sendChatMessage(msg);
      try { const d = require('./discord'); if (d.notifySub) d.notifySub(`${gifter} (x${quantity} gift bomb)`, 1, true).catch(console.error); } catch(e) {}
    }

    else if (eventType === 'channel.followed') {
      const follower = body.follower?.username || 'Someone';
      console.log(`💜 Webhook follow: ${follower}`);
      const followResponses = [
        `@${follower} welcome to the EvilSheep gang! 🐑 you're one of us now`,
        `@${follower} just followed — smart move lad, pull up a chair`,
        `@${follower} has joined the EvilSheep gang 🐑 stand sprayers only from here`,
        `@${follower} welcome in! don't ask about the monitor refresh rate`,
        `oi oi @${follower} welcome to the gang, grab some spray cans on the way in 🐑`,
      ];
      const msg = followResponses[Math.floor(Math.random() * followResponses.length)];
      await sendChatMessage(msg);
      try { const d = require('./discord'); if (d.notifyFollow) d.notifyFollow(follower).catch(console.error); } catch(e) {}
    }

    else if (eventType === 'livestream.status.updated') {
      const isLive = body.is_live;
      console.log(`📡 Webhook live status: ${isLive ? 'LIVE' : 'offline'}`);
      if (isLive && !goLiveFired) handleGoLive().catch(console.error);
      else if (!isLive) { streamStartTime = null; goLiveFired = false; }
    }

  } catch(e) { console.error('Webhook handler error:', e.message); }
});

app.get('/logout', (req, res) => {
  tokens = null;
  try { require('fs').unlinkSync(TOKEN_FILE); } catch(e) {}
  console.log('🔓 Tokens cleared — re-auth required');
  res.redirect('/');
});

app.get('/status', (req, res) => {
  res.json({
    authorized: !!tokens,
    expires_at: tokens?.expires_at ? new Date(tokens.expires_at).toISOString() : null,
    expired: tokens ? Date.now() > tokens.expires_at : true,
  });
});

// Internal token endpoint — bot fetches this to get latest tokens
app.get('/internal/tokens', (req, res) => {
  if (tokens) res.json(tokens);
  else res.status(404).json({ error: 'no tokens' });
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
      subscribeToWebhooks(data.access_token).catch(console.error);
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
  loadMemory();
  tokens = loadTokens();
  if (tokens) {
    console.log('✅ Tokens loaded from storage!');
    refreshTokens();
  } else {
    console.log('⚠️ No tokens — visit Railway URL to authorize');
  }

  // Load mod tokens (5headnn ban powers)
  modTokens = loadModTokens();
  if (modTokens) {
    console.log('✅ Mod tokens loaded — ban powers active!');
  } else {
    console.log('⚠️ No mod tokens — visit /mod-auth to authorize ban powers');
  }

  connectToKick();

  // Re-subscribe to webhooks on startup using saved token
  setTimeout(async () => {
    const tok = await getToken();
    if (tok) {
      console.log('🔔 Re-subscribing to webhooks on startup...');
      subscribeToWebhooks(tok).catch(console.error);
    }
  }, 5000); // Wait 5s for tokens to load
});
