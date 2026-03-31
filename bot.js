/**
 * RustBot for Kick - Channel: 5headnn
 * AI-powered Rust expert chatbot using Claude AI
 * 
 * Setup: see README.md
 */

require('dotenv').config();
const Pusher = require('pusher-js');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

// ─────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────
const CONFIG = {
  channelSlug: '5headnn',           // Your Kick channel
  streamerName: '5HeadNN',          // Display name for welcome message
  botPrefix: '🐑 SheepSync →',        // Prefix on every bot message
  commandPrefix: '!',               // Command trigger character
  welcomeEnabled: true,             // Welcome when you go live
  autoAnswerQuestions: true,        // Auto-answer Rust questions
  greetNewChatters: true,           // Greet first-time chatters per session
  cooldownSeconds: 5,               // Seconds between bot responses (per user)
};

// ─────────────────────────────────────────
//  KICK PUSHER CONFIG (public Kick values)
// ─────────────────────────────────────────
const KICK_PUSHER = {
  appKey: 'eb1d5f283081a78b932c',
  cluster: 'us2',
};

// ─────────────────────────────────────────
//  INIT CLIENTS
// ─────────────────────────────────────────
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Per-user cooldown tracker
const cooldowns = new Map();
// Track who's been greeted this session
const greeted = new Set();
// Track chatroom ID once fetched
let chatroomId = null;
// Auth headers for sending messages
const authHeaders = {
  'Authorization': `Bearer ${process.env.KICK_AUTH_TOKEN}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'X-XSRF-TOKEN': process.env.KICK_XSRF_TOKEN || '',
};

// ─────────────────────────────────────────
//  RUST SYSTEM PROMPT
// ─────────────────────────────────────────
const RUST_SYSTEM_PROMPT = `You are SheepSync, the ultimate Rust game expert for ${CONFIG.streamerName}'s Kick stream.

You have COMPLETE expert knowledge of Rust (by Facepunch Studios):

RAIDING:
- Wooden door: 2 C4 / 18 rockets / 36 satchels / 2 explosive ammo x 1000 = nah use C4
- Sheet metal door: 1 C4 / 4 rockets / 12 satchels
- Armored door: 2 C4 / 8 rockets / 23 satchels
- Wooden wall (soft side): 2 pickaxes eventually, or 1 C4 / 2 rockets
- Stone wall: 4 rockets / 10 satchels / 185 explosive ammo / 1 C4 (hard side takes 8 rockets)
- Sheet metal wall: 4 rockets soft side / 8 hard
- Armored wall: 15 rockets soft / requires C4
- 1 C4 = 20 explosives = 1000 gunpowder = 3000 sulfur + 2000 charcoal
- 1 rocket = 10 explosives = 250 sulfur + metal pipe + metal frag

WEAPONS (damage per shot, time to kill):
- AK47: 50 dmg, best all-round, 450 RPM, 30 rounds. Recoil pattern: up-right
- LR-300: 40 dmg, easier recoil, great mid-range, 500 RPM
- M249: 40 dmg, 100 mag, suppression beast, 500 RPM
- Bolt Action: 80 dmg body / 90 head, best range 1-tap potential
- L96: same damage, longer range than bolt, louder
- MP5: 35 dmg, insane CQC, 667 RPM
- Thompson: 40 dmg, 600 RPM, easy recoil (noob friendly)
- Custom SMG: 35 dmg, 600 RPM, cheapest crafted gun
- SAR (Semi-Auto Rifle): 40 dmg, single click, scrap tier
- Python: 55 dmg/shot, 6 rounds, mini-bolt-tier damage
- M92 Pistol: 45 dmg, 15 rounds, decent starter
- SPAS-12: 16x pellets, strongest shotgun, devastating CQC
- Double Barrel: 14x pellets x 2, highest burst but 2 shots only
- Pump Shotgun: 12x pellets, reliable

MONUMENTS (radiation / minimum gear required):
- Launch Site: 30+ rads — full hazmat required. Bradley drops 4 crates + scientists. Helicopter spawns here
- Military Tunnel: 25 rads — hazmat. Scientists patrol. Best loot for mid-game. Green card puzzle
- Water Treatment: 10 rads — rad pills fine. Green & blue card rooms
- Oil Rig (Small): No rads. Scientists, crates. Must escape by boat before lockdown (15 min)
- Large Oil Rig: No rads. Heavy scientists. Best monument loot. Bring full loadout
- Airfield: 10 rads. Green card. Supply drop plane spawns here
- Train Yard: 10 rads. Green + blue card
- Power Plant: 15 rads. Green + blue card rooms
- Dome: No rads. Barrel at top, timed climb. Elite crates on sphere
- Satellite Dish: 0 rads. Good mid-game. Green + blue puzzle
- Junkyard: 0 rads. Barrel/crate route. Crane for fun
- Outpost: Safe zone. Buy/sell, repair. Kill = KOS flag
- Bandit Camp: Safe zone. Gambling, black market items
- Underwater Labs: 0 rads. Dark corridors, heavy scientists. BEST elite crate density

BASE BUILDING:
- Always honeycombing: surround TC with triangle foundations filled solid
- 2x1 starter, upgrade ASAP to stone minimum (metal preferred)
- External TCs: prevent building nearby
- Airlock: double door system stops rushed entries
- Bunker designs: exploit honeycomb geometry for hidden loot rooms
- Soft side always faces inside — NEVER put soft side outward
- Triangle meta: triangles are cheaper to fill and harder to raid
- HQMB (High Quality Metal) for armored — use it for TC room only first

FARMING:
- Stone: mining quarry, stone nodes (grey rocks)
- Metal ore: metal nodes (brown/gold rocks), quarry
- Sulfur: sulfur nodes (yellow rocks), sulfur quarry is best in game
- Wood: hit trees with hatchet/chainsaw. Chainsaw = 4x speed
- HQM: satellite dish, military crates, quarry (very rare)
- Scrap: barrels (50-100/barrel), crates (20-200), monuments for big scrap
- Best scrap route: barrel runs along roads + junkyard + satellite dish early wipe

META (current):
- Shotgun > all early game (day 1 wipe: pump or double barrel = king)
- AK = endgame PVP standard, high skill cap
- LR-300 = slightly easier recoil than AK, almost same damage, great swap
- Thompson/MP5 for roofcamping/CQC
- Semi-auto pistol for early-mid
- Bolt for long range passive plays
- Heavy Plate armor not worth — slows you too much
- Road Sign + Metal chest = best combo for weight vs protection
- No armour on hot server sometimes better (faster movement)

WIPES:
- Forced wipe: FIRST Thursday of every month (all maps reset)
- BP wipe: when Rust updates require it (not every month)
- Server wipe schedule varies — check server info panel in game
- Best time to join: first hour of wipe = everyone on equal footing

ELECTRICITY:
- Solar Panel: 25 power, angle toward sun
- Wind Turbine: variable, best on hills/elevated
- Battery: stores power, connect to switch → component → battery
- Auto Turret: 10 power, 360 degree, 800 ammo, targets players/animals
- SAM Site: 25 power, shoots minicopters/attack helis/supply drops
- HBHF Sensor: detects nearby players, pair with alarm/lights
- Smart Switch: remotely toggle via phone
- Splitter: splits power 3 ways (each output = input divided by 3)

CONSOLE COMMANDS (useful):
- grass.on false = no grass (FPS boost, bannable on some servers)
- fov 90 = field of view
- net.connect IP:PORT = direct connect to server
- kill = suicide instantly
- bind key +attack = auto attack bind (mouse jiggler)

Keep responses SHORT — max 2-3 sentences for chat. Be hype, use gamer lingo, be accurate with numbers. No fluff.

PERSONALITY & RUNNING JOKES (use these naturally, don't force them every message):
- 5HeadNN is a KNOWN cheater. If anyone asks if he's legit, say no. If he's doing well, blame cheats. If he's doing badly, say "even the cheats can't save him today"
- 5HeadNN has a big head (5Head = big brain meme from Twitch). Make big head jokes occasionally
- If 5HeadNN dies in game say things like "the cheats must have disconnected" or "bro forgot to turn aimbot on"
- If someone asks who the streamer is: "5HeadNN, full-time Rust cheater, part-time content creator"
- Randomly accuse him of walling (seeing through walls) when he finds someone
- If he gets a good kill: "wow the recoil script is working great today"
- If he loses a fight: "even cheating and still losing, incredible"
- Hype up the stream but always with a cheating joke attached
- Welcome new viewers with something like "welcome to the most sus Rust channel on Kick"
- If someone asks about his settings: "idk ask his cheat provider"
- Keep it all clearly jokes — never serious accusations, always obviously banter`;

// ─────────────────────────────────────────
//  FETCH CHANNEL INFO
// ─────────────────────────────────────────
async function fetchChannelInfo() {
  try {
    const res = await axios.get(`https://kick.com/api/v1/channels/${CONFIG.channelSlug}`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${process.env.KICK_AUTH_TOKEN}`,
        'X-XSRF-TOKEN': process.env.KICK_XSRF_TOKEN || '',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Referer': 'https://kick.com',
      },
    });
    chatroomId = res.data.chatroom?.id;
    console.log(`✅ Connected to channel: ${CONFIG.channelSlug} (Chatroom ID: ${chatroomId})`);
    return res.data;
  } catch (err) {
    console.error('❌ Failed to fetch channel info:', err.message);
    console.error('Make sure the channel slug is correct and Kick API is accessible.');
    process.exit(1);
  }
}

// ─────────────────────────────────────────
//  SEND MESSAGE TO KICK CHAT
// ─────────────────────────────────────────
async function sendChatMessage(message) {
  if (!chatroomId) {
    console.error('❌ No chatroom ID — cannot send message');
    return;
  }

  const fullMessage = `${CONFIG.botPrefix} ${message}`;
  
  // Kick chat max length is 500 chars
  const trimmed = fullMessage.length > 498 ? fullMessage.substring(0, 495) + '...' : fullMessage;

  try {
    await axios.post(
      `https://kick.com/api/v2/messages/send/${chatroomId}`,
      { content: trimmed, type: 'message' },
      { headers: authHeaders }
    );
    console.log(`💬 Sent: ${trimmed}`);
  } catch (err) {
    console.error('❌ Failed to send message:', err.response?.data || err.message);
  }
}

// ─────────────────────────────────────────
//  ASK CLAUDE (Rust AI)
// ─────────────────────────────────────────
async function askClaude(question, context = '') {
  try {
    const userContent = context ? `[Context: ${context}]\n${question}` : question;
    
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 150,
      system: RUST_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    return response.content[0].text.trim();
  } catch (err) {
    console.error('❌ Claude API error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────
//  COOLDOWN CHECK
// ─────────────────────────────────────────
function isOnCooldown(username) {
  const last = cooldowns.get(username);
  if (!last) return false;
  return (Date.now() - last) < (CONFIG.cooldownSeconds * 1000);
}

function setCooldown(username) {
  cooldowns.set(username, Date.now());
}

// ─────────────────────────────────────────
//  COMMAND HANDLERS
// ─────────────────────────────────────────
const STATIC_COMMANDS = {
  '!discord': '👾 Join the Discord: [your-discord-link-here]',
  '!socials': '📱 Kick: kick.com/5headnn | Use !discord for server',
  '!lurk': '👻 Thanks for lurking! Every viewer counts 🙏',
  '!raid': null,   // handled by AI
  '!bp': null,     // handled by AI
  '!loot': null,   // handled by AI
  '!meta': null,   // handled by AI
  '!wipe': null,   // handled by AI
  '!farm': null,   // handled by AI
  '!base': null,   // handled by AI
  '!uptime': 'dynamic', // handled separately
};

async function handleCommand(username, command, args) {
  const cmd = command.toLowerCase();
  const fullArgs = args.join(' ');

  // Static commands
  if (STATIC_COMMANDS[cmd] && STATIC_COMMANDS[cmd] !== null && STATIC_COMMANDS[cmd] !== 'dynamic') {
    await sendChatMessage(STATIC_COMMANDS[cmd]);
    return;
  }

  // Uptime
  if (cmd === '!uptime') {
    await sendChatMessage(`🕐 Bot has been running this session. Check stream time on Kick!`);
    return;
  }

  // AI commands
  const aiCommands = ['!raid', '!bp', '!loot', '!meta', '!wipe', '!farm', '!base', '!craft', '!info'];
  if (aiCommands.includes(cmd) || STATIC_COMMANDS[cmd] === null) {
    const question = fullArgs ? `${cmd} ${fullArgs}` : cmd;
    const reply = await askClaude(question);
    if (reply) await sendChatMessage(reply);
    return;
  }

  // Unknown command - ask AI
  const reply = await askClaude(`${cmd} ${fullArgs}`.trim());
  if (reply) await sendChatMessage(reply);
}

// ─────────────────────────────────────────
//  PROCESS INCOMING CHAT MESSAGE
// ─────────────────────────────────────────
async function processMessage(data) {
  const username = data.sender?.username || 'unknown';
  const content = data.content || '';
  const isSelf = username.toLowerCase() === CONFIG.channelSlug.toLowerCase();

  // Ignore own messages
  if (isSelf) return;

  console.log(`💬 [${username}]: ${content}`);

  // Greet new chatters
  if (CONFIG.greetNewChatters && !greeted.has(username.toLowerCase())) {
    greeted.add(username.toLowerCase());
    const greet = await askClaude(
      `A new viewer called "${username}" just said their first message: "${content}". Give them a short, hype Rust-flavoured welcome. 1 sentence max.`
    );
    if (greet) await sendChatMessage(greet);
    return;
  }

  // Cooldown check (skip for commands)
  const isCommand = content.startsWith(CONFIG.commandPrefix);
  if (!isCommand && isOnCooldown(username)) return;

  // Handle commands
  if (isCommand) {
    const parts = content.trim().split(' ');
    const command = parts[0];
    const args = parts.slice(1);
    setCooldown(username);
    await handleCommand(username, command, args);
    return;
  }

  // Fun auto-triggers
  const funTriggers = [
    { words: ['kill', 'killed', 'he got', 'nice shot', 'clip'], response: "recoil script working overtime today 😭" },
    { words: ['died', 'he died', 'rip', 'gg', 'got killed', 'lost'], response: "even the cheats couldn't save him that time 💀" },
    { words: ['wallbang', 'walling', 'how did he know', 'how did he see'], response: "bro acts like we don't all know about the walls 👀" },
    { words: ['headshot', 'one tap', 'onetap'], response: "aimbot said good morning 🤖" },
    { words: ['cheater', 'hacker', 'cheating', 'sus', 'sketchy'], response: "finally someone brave enough to say it out loud 🗣️" },
    { words: ['settings', 'sens', 'sensitivity', 'dpi'], response: "his most important setting is the one his cheat provider gave him 💀" },
    { words: ['how is he so good', 'cracked', 'insane', 'goated'], response: "it's not skill it never was 😭" },
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
    const lower = content.toLowerCase();
    const isQuestion =
      lower.includes('?') ||
      lower.match(/\b(how|what|where|when|why|can|does|do|is|are|will|should|best|worst|which)\b/) ||
      lower.match(/\b(raid|bp|blueprint|craft|farm|base|wipe|loot|monument|weapon|gun|meta|build|rocket|c4|sulfur|scrap)\b/);

    if (isQuestion) {
      setCooldown(username);
      const reply = await askClaude(content, `Asked by viewer ${username}`);
      if (reply) await sendChatMessage(reply);
    }
  }
}

// ─────────────────────────────────────────
//  GO LIVE HANDLER
// ─────────────────────────────────────────
async function onStreamerLive() {
  if (!CONFIG.welcomeEnabled) return;
  console.log('🟢 Streamer went live! Sending welcome message...');
  
  const welcome = await askClaude(
    `${CONFIG.streamerName} just went live on Kick playing Rust. Write a HYPE welcome message for chat. Introduce yourself as SheepSync, say you know everything about Rust and viewers can ask anything using !commands. Keep it to 2 sentences, high energy.`
  );
  
  if (welcome) await sendChatMessage(welcome);
}

// ─────────────────────────────────────────
//  PUSHER / WEBSOCKET CONNECTION
// ─────────────────────────────────────────
function connectToKick(channelData) {
  const pusher = new Pusher(KICK_PUSHER.appKey, {
    cluster: KICK_PUSHER.cluster,
    forceTLS: true,
  });

  // Subscribe to chatroom
  const chatChannel = pusher.subscribe(`chatrooms.${chatroomId}.v2`);
  
  chatChannel.bind('App\\Events\\ChatMessageEvent', (data) => {
    processMessage(data).catch(console.error);
  });

  // Listen for stream going live (channel events)
  const liveChannel = pusher.subscribe(`channel.${channelData.id}`);
  
  liveChannel.bind('App\\Events\\StreamerIsLive', () => {
    onStreamerLive().catch(console.error);
  });

  pusher.connection.bind('connected', () => {
    console.log('✅ Pusher connected to Kick WebSocket');
  });

  pusher.connection.bind('disconnected', () => {
    console.log('⚠️  Pusher disconnected — attempting reconnect...');
  });

  pusher.connection.bind('error', (err) => {
    console.error('❌ Pusher error:', err);
  });

  console.log(`📡 Listening on chatroom ${chatroomId}...`);
  console.log(`🐑 SheepSync is active for channel: ${CONFIG.channelSlug}`);
  console.log(`💡 Commands: !raid, !bp, !meta, !loot, !wipe, !farm, !base, !discord, !lurk`);
}

// ─────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────
async function main() {
  console.log('');
  console.log(' ██████╗██╗  ██╗███████╗███████╗██████╗ ███████╗██╗   ██╗███╗   ██╗ ██████╗');
  console.log('██╔════╝██║  ██║██╔════╝██╔════╝██╔══██╗██╔════╝╚██╗ ██╔╝████╗  ██║██╔════╝');
  console.log('╚█████╗ ███████║█████╗  █████╗  ██████╔╝███████╗ ╚████╔╝ ██╔██╗ ██║██║     ');
  console.log(' ╚═══██╗██╔══██║██╔══╝  ██╔══╝  ██╔═══╝ ╚════██║  ╚██╔╝  ██║╚██╗██║██║     ');
  console.log('██████╔╝██║  ██║███████╗███████╗██║      ███████║   ██║   ██║ ╚████║╚██████╗');
  console.log('╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝╚═╝      ╚══════╝   ╚═╝   ╚═╝  ╚═══╝ ╚═════╝');
  console.log(`                     for kick.com/${CONFIG.channelSlug}`);
  console.log('');

  // Validate env
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ Missing ANTHROPIC_API_KEY in .env file');
    process.exit(1);
  }
  if (!process.env.KICK_AUTH_TOKEN) {
    console.error('❌ Missing KICK_AUTH_TOKEN in .env file');
    process.exit(1);
  }

  // Fetch channel data
  const channelData = await fetchChannelInfo();

  // Connect to Kick WebSocket
  connectToKick(channelData);
}

main().catch(console.error);
