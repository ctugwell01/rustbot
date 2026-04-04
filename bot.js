/**
 * SheepSync — AI Rust Chatbot for kick.com/5headnn
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

const TOKEN_FILE = '/tmp/tokens.json';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app = express();
app.use(express.json());

let tokens = null;
let codeVerifier = null;
const cooldowns = new Map();
const greeted = new Set();
const returning = new Set();
let streamStartTime = null;

const AUTO_MESSAGES = [
  "if you're enjoying the stream smash that follow button, costs nothing and means everything",
  "new here? chuck a follow and join the EvilSheep gang, we dont bite... much",
  "subs get treated like royalty around here, just saying. !discord to join the community",
  "reminder that !commands exist if you want Rust help from your favourite Welsh degen bot",
  "if 5head carries this fight its the cheats. if he dies its skill issue. simple as",
  "use !predict to see if 5head wins his next fight, spoiler: the scripts decide",
  "enjoying the chaos? follow the channel and join the EvilSheep Discord: https://discord.gg/4DHRdH9dz5",
  "subs are big chads. NNs are NNs. the choice is yours lads",
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
  tokens = t;
  // Save to file as backup
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(t)); } catch(e) {}
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
    // Try official moderation endpoint first
    const res = await fetch(`https://api.kick.com/public/v1/channels/${CONFIG.broadcasterId}/bans`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ banned_user: username, permanent: true, reason: 'Spam detected by SheepSync' }),
    });
    const data = await res.json();
    if (res.ok) {
      console.log(`🔨 Banned: ${username}`);
    } else {
      console.error('Ban failed:', data);
      // Fallback: send /ban command via chat
      await sendChatMessage(`/ban ${username} spam bot`);
    }
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
  '!discord': 'https://discord.gg/4DHRdH9dz5',
  '!socials': 'Kick: kick.com/5headnn | Discord: https://discord.gg/4DHRdH9dz5',
  '!lurk': 'thanks for lurking me big W',
  '!cheat': 'https://evilsheep.io/',
  '!cheats': 'https://evilsheep.io/',
  '!drops': 'Drops begin on 11/13 make sure to visit https://kick.facepunch.com/ and follow the directions to get your free Rust skin!',
  '!evilsheep': 'Check out EvilSheep: https://evilsheep.io/',
  '!combatarena': 'Best Rust minigame server in the US — Combat Arena built by Kris himself. Go check it out!',
  '!clip': 'To clip the stream hit the scissors icon below the stream or press C on keyboard — share your clips in Discord!',
  '!commands': '!raid !bp !meta !loot !wipe !farm !base !discord !lurk !cheat !drops !combatarena !clip !uptime !predict',
};

// ─────────────────────────────────────────
//  PROCESS MESSAGE
// ─────────────────────────────────────────
async function processMessage(data) {
  const username = data.sender?.username || '';
  const content = data.content || '';
  // Ignore own messages and protected bot accounts
  const IGNORED_BOTS = ['sheepsyncbot', 'botrix', 'streamelements', 'nightbot', 'moobot'];
  if (!username || IGNORED_BOTS.includes(username.toLowerCase())) return;

  // Link filter — delete links from non-mods/non-subs
  const hasLink = /https?:\/\/|www\.|\.com|\.io|\.gg|\.tv|\.net|\.org/i.test(content);
  if (hasLink && !isVIP && !isSub) {
    await deleteMessage(data.id || null);
    await sendChatMessage(`links are for subs and mods only NN, get it deleted`, username);
    console.log(`🔗 Link deleted from ${username}: ${content}`);
    return;
  }

  // Stream sniper detection — ignore the streamer himself
  const isStreamer = username.toLowerCase() === '5headnn';
  if (!isStreamer && SNIPER_PATTERNS.some(p => p.test(content))) {
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
  const isOwner = username.toLowerCase() === '5headnn';
  const isVIP = isOwner || badges.some(b => b.type === 'vip' || b.type === 'moderator' || b.type === 'broadcaster');
  const isSub = badges.some(b => b.type === 'subscriber' || b.type === 'og' || b.type === 'founder');
  const userStatus = isVIP ? '[VIP]' : isSub ? '[SUB]' : '[VIEWER]';

  console.log(`💬 [${username}] ${userStatus}: ${content}`);
  const lower = content.toLowerCase();

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
    const r = await askClaude(`${userStatus} viewer ${username} is talking to you (SheepSync the chatbot) directly and says: "${question}". You are a chatbot in the stream chat, not a player. Answer naturally as a chatbot would. If they are asking about stream snipers, Rust, 5HeadNN or anything stream related — answer in context of being a Kick stream chatbot.`);
    if (r) await sendChatMessage(r, username);
    setCD(username);
    return;
  }

  if (!isCmd && isCD(username)) return;

  if (isCmd) {
    const [cmd, ...rest] = content.trim().split(' ');
    const args = rest.join(' ');
    const cmdLower = cmd.toLowerCase();

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

  // Only respond if toxic towards 5head
  const is5headInsult = lower.match(/\b(5head|5headnn|streamer)\b/) && 
    lower.match(/\b(bad|trash|garbage|noob|nn|sucks|terrible|awful|dogsh|garbage|worst|crap|cheater|hacker)\b/);
  
  if (is5headInsult) { 
    setCD(username); 
    const r = await askClaude(`${userStatus} viewer ${username} is being toxic about 5HeadNN saying: "${content}". Defend 5head in Welsh Valleys degen style, call them a NN if not subbed. Short and spicy.`); 
    if (r) await sendChatMessage(r, username); 
  }
}

// ─────────────────────────────────────────
//  GO LIVE HANDLER
// ─────────────────────────────────────────
async function handleGoLive() {
  streamStartTime = Date.now();
  console.log('🟢 Firing go live handler!');
  try { await announceGoLive(); } catch(e) { console.error('Discord announce error:', e.message); }
  const welcome = await askClaude('5HeadNN just went live on Kick playing Rust. Welcome him in a casual Welsh Valleys style — low key, not too hype, maybe a light dig at him too. Short and natural like a mate welcoming another mate. Mention the cheating banter, stand spraying, and tell chat they can use !commands. Max 2 sentences, keep it real not cringe.');
  if (welcome) await sendChatMessage(welcome);
}

// ─────────────────────────────────────────
//  PUSHER
// ─────────────────────────────────────────
function connectToKick() {
  const PusherClass = Pusher.default ? Pusher.default : Pusher;
  const pusher = new PusherClass('32cbd69e4b950bf97679', {
    wsHost: 'ws-us2.pusher.com', cluster: 'us2', forceTLS: true, disableStats: true,
  });
  const chatRoom = pusher.subscribe(`chatrooms.${CONFIG.chatroomId}.v2`);
  chatRoom.bind('App\\Events\\ChatMessageEvent', d => processMessage(d).catch(console.error));

  // Sub / gift sub events — bind multiple possible event names
  const handleSubEvent = async (data) => {
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
  };

  chatRoom.bind('App\\Events\\SubscriptionEvent', handleSubEvent);
  chatRoom.bind('App\\Events\\GiftedSubscriptionsEvent', handleSubEvent);
  chatRoom.bind('App\\Events\\UserSubscribed', handleSubEvent);
  chatRoom.bind('App\\Events\\ChatMessageEvent', async (data) => {
    // Detect sub messages from Kick system
    if (data?.sender?.username === 'Kick' || data?.type === 'subscription') {
      await handleSubEvent(data);
    }
  });
  pusher.connection.bind('connected', () => console.log('✅ Pusher connected!'));
  pusher.connection.bind('disconnected', () => console.log('⚠️ Pusher disconnected...'));

  // Welcome 5head when stream goes live
  // Pusher live events (backup)
  const liveChannel = pusher.subscribe(`channel.${CONFIG.channelSlug}`);
  liveChannel.bind('App\\Events\\StreamerIsLive', () => handleGoLive());
  liveChannel.bind('App\\Events\\LivestreamUpdated', () => handleGoLive());

  // Poll Kick API every 60 seconds to detect going live automatically
  let wasLive = false;
  setInterval(async () => {
    try {
      const res = await fetch(`https://kick.com/api/v1/channels/${CONFIG.channelSlug}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
      });
      const data = await res.json();
      const isLive = data?.livestream?.is_live === true;

      if (isLive && !wasLive) {
        wasLive = true;
        console.log('🟢 5HeadNN is live (detected by poll)!');
        await handleGoLive();
      } else if (!isLive && wasLive) {
        wasLive = false;
        streamStartTime = null;
        console.log('🔴 Stream ended');
      }
    } catch(e) {
      console.error('Live check error:', e.message);
    }
  }, 60000);
  console.log(`📡 Listening on chatroom ${CONFIG.chatroomId}`);
  console.log(`🐑 SheepSync active! Commands: !raid !bp !meta !loot !wipe !farm !base !discord !lurk`);

  // Auto message every 30 minutes
  setInterval(async () => {
    if (!streamStartTime) return; // Only when live
    const msg = AUTO_MESSAGES[Math.floor(Math.random() * AUTO_MESSAGES.length)];
    await sendChatMessage(msg);
    console.log('📢 Auto message sent');
  }, 30 * 60 * 1000);
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
