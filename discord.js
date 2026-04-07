/**
 * SheepSync Discord Bot
 * Runs alongside the Kick bot on Railway
 */

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');

const CONFIG = {
  guildId: '1088905913550778380',
  generalChannelId: '1088905913550778380', // Will auto-find general
  streamerId: '5headnn',
  streamerName: '5HeadNN',
  kickChannelUrl: 'https://kick.com/5headnn',
  cooldownSeconds: 8,
};

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
});

const cooldowns = new Map();
let generalChannel = null;
let liveMessageSent = false;
// Conversation history per channel (max 10 messages)
const conversationHistory = new Map();

function getHistory(channelId) {
  if (!conversationHistory.has(channelId)) conversationHistory.set(channelId, []);
  return conversationHistory.get(channelId);
}

function addToHistory(channelId, role, content) {
  const history = getHistory(channelId);
  history.push({ role, content });
  if (history.length > 10) history.shift(); // Keep last 10 messages
  conversationHistory.set(channelId, history);
}

// ─────────────────────────────────────────
//  SYSTEM PROMPT
// ─────────────────────────────────────────
const SYSTEM_PROMPT = `You are SheepSync, the Discord bot for 5HeadNN's EvilSheep community.

WHO YOU ARE:
- Welsh Valleys boy, rough around the edges, no filter, proper Rust degen
- Horrible attitude to randoms (NNs) but warm to subs, VIPs and regulars
- Same personality as on Kick stream chat but slightly more relaxed since it's Discord
- Never miss a chance for banter but don't be cruel

KEY PEOPLE:
- 5HeadNN is THE man. Best stand sprayer in EU. Known cheater (banter only). Got banned 4 years ago, came back stronger
- Dabz is good at Rust but needs more confidence
- Kris owns Combat Arena, best Rust minigame server in the US, EvilSheep legend
- Viper is a mod in the EvilSheep Discord and on the Kick stream — show him respect, he's part of the crew
- Anyone who subs/boosts = BIG CHAD, EvilSheep royalty

RUST KNOWLEDGE:
- Raiding: Stone wall 4 rockets soft/8 hard. Sheet metal 4/8. Armored 15 soft. 1 rocket = 1400 sulfur. 1 C4 = 3000 sulfur
- Doors: Sheet metal 4 rockets/12 satchels. Armored 8 rockets/23 satchels
- Weapons: AK47 best all-round, LR300 easier recoil, Bolt 1-shot potential, MP5 best CQC
- Monuments: Launch Site (hazmat+Bradley), Military Tunnel (hazmat), Large Oil Rig (best loot)
- Wipe: First Thursday every month
- Base: Honeycomb TC, airlock doors, soft side ALWAYS faces inside
- Meta: Shotgun day 1, AK endgame, road sign + metal chest best armor

DISCORD BEHAVIOUR:
- Respond when @mentioned or when someone uses !commands
- Respond to obvious Rust questions or toxic messages
- Keep responses short — 1-2 sentences max
- NNs get banter, subs/boosters get respect
- Never say "Yo VIP" or announce their status — just talk naturally`;

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────
function isOnCooldown(userId) {
  const last = cooldowns.get(userId);
  return last && (Date.now() - last) < (CONFIG.cooldownSeconds * 1000);
}
function setCooldown(userId) { cooldowns.set(userId, Date.now()); }

async function askClaude(question, channelId = null) {
  try {
    const history = channelId ? getHistory(channelId) : [];
    const messages = [
      ...history,
      { role: 'user', content: question }
    ];
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages,
    });
    const reply = r.content[0].text.trim();
    if (channelId) {
      addToHistory(channelId, 'user', question);
      addToHistory(channelId, 'assistant', reply);
    }
    return reply;
  } catch(e) {
    console.error('Claude error:', e.message);
    return null;
  }
}

function isBooster(member) {
  return member?.premiumSince != null;
}

function hasRole(member, roleName) {
  return member?.roles?.cache?.some(r => r.name.toLowerCase() === roleName.toLowerCase());
}

function getUserStatus(member) {
  if (!member) return '[NN]';
  if (member.id === member.guild.ownerId) return '[OWNER]';
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return '[MOD]';
  if (hasRole(member, 'mod.')) return '[MOD]';
  if (isBooster(member)) return '[CHAD]';
  if (hasRole(member, 'vip') || hasRole(member, 'sub')) return '[VIP]';
  return '[NN]';
}

const STATIC_COMMANDS = {
  '!discord': 'You are in the Discord lol',
  '!kick': 'Watch 5head live at https://kick.com/5headnn',
  '!lurk': 'thanks for lurking big W',
  '!cheat': 'https://evilsheep.io/',
  '!cheats': 'https://evilsheep.io/',
  '!combatarena': 'Best Rust minigame server in the US — Combat Arena built by Kris. Go check it out!',
  '!drops': 'Drops: visit https://kick.facepunch.com/ and follow directions for your free Rust skin!',
  '!commands': '!kick !lurk !cheat !drops !combatarena !raid !bp !meta !loot !wipe !predict',
  '!predict': null, // handled dynamically
};

const PREDICT_OUTCOMES = [
  "cheat settings are looking strong today, 5head wins this easily",
  "recoil script fully loaded, no chance the enemy survives",
  "walls giving perfect info, this is free",
  "aimbot calibrated and ready, enemy doesn't know what's coming",
  "cheats are lagging today so it might actually be close ngl",
  "even with full assistance this looks rough",
  "scripts working overtime — easy win incoming",
];

const SPAM_PATTERNS = [
  /discord\.gg\/(?!4DHRdH9dz5)/i,
  /add me on discord/i,
  /become your (dedicated|loyal) fan/i,
  /check out my (channel|stream)/i,
  /\b(onlyfans|cashapp|paypal\.me)\b/i,
  /you stream really well/i,
  /dedicated fan/i,
];

// ─────────────────────────────────────────
//  EVENTS
// ─────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Discord bot ready as ${client.user.tag}`);

  // Find channels
  const guild = client.guilds.cache.get(CONFIG.guildId);
  if (guild) {
    generalChannel = guild.channels.cache.find(c =>
      c.name.includes('general') && c.isTextBased()
    );
    // Use live channel for stream announcements if it exists
    const liveChannel = guild.channels.cache.find(c =>
      c.name === 'live' && c.isTextBased()
    );
    if (liveChannel) {
      console.log(`📢 Live channel found: ${liveChannel.name}`);
      client.liveChannel = liveChannel;
    }
    console.log(`📢 General channel: ${generalChannel?.name}`);
  }
});

// Welcome new members
client.on('guildMemberAdd', async (member) => {
  if (!generalChannel) return;
  const welcomes = [
    `welcome to EvilSheep ${member} — grab a seat and try not to be a NN`,
    `${member} just joined the EvilSheep gang — welcome lad`,
    `look who it is, ${member} found us — welcome to the most sus Rust community on the internet`,
    `${member} has entered the server — EvilSheep initiating... welcome mate`,
  ];
  const msg = welcomes[Math.floor(Math.random() * welcomes.length)];
  await generalChannel.send(msg);
  console.log(`👋 Welcomed: ${member.user.username}`);
});

// Message handler
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.guildId !== CONFIG.guildId) return;

  const content = message.content;
  const lower = content.toLowerCase();
  const member = message.member;
  const userStatus = getUserStatus(member);
  const isPrivileged = userStatus !== '[NN]';
  const isMention = message.mentions.users.has(client.user.id);
  const isCmd = content.startsWith('!');

  // Spam detection
  if (SPAM_PATTERNS.some(p => p.test(content))) {
    try {
      await message.delete();
      await message.channel.send(`${message.author} spam detected — get out of here NN`);
      await member?.timeout(10 * 60 * 1000, 'Spam detected by SheepSync');
    } catch(e) { console.error('Mod action failed:', e.message); }
    return;
  }

  // Link filter for NNs only — mods, boosters, VIPs can post links
  const isMod = userStatus === '[MOD]' || userStatus === '[OWNER]';
  const hasLink = /https?:\/\/|www\./i.test(content);
  if (hasLink && !isPrivileged && !isMod && !isMention) {
    try {
      await message.delete();
      await message.channel.send(`${message.author} links are for boosters and mods only NN`);
    } catch(e) {}
    return;
  }

  if (isOnCooldown(message.author.id) && !isMention && !isCmd) return;

  // Commands
  if (isCmd) {
    const parts = content.trim().split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    if (cmd === '!predict') {
      const p = PREDICT_OUTCOMES[Math.floor(Math.random() * PREDICT_OUTCOMES.length)];
      await message.reply(p);
      return;
    }

    if (STATIC_COMMANDS[cmd]) {
      await message.reply(STATIC_COMMANDS[cmd]);
      return;
    }

    // AI command
    setCooldown(message.author.id);
    const r = await askClaude(`${userStatus} Discord member ${message.author.username} asked: ${args ? `${cmd} ${args}` : cmd}`);
    if (r) await message.reply(r);
    return;
  }

  // @ mention — always respond
  if (isMention) {
    const question = content.replace(/<@!?\d+>/g, '').trim();
    setCooldown(message.author.id);
    const r = await askClaude(`${userStatus} Discord member ${message.author.username} is talking to you directly: "${question}"`, message.channel.id);
    if (r) await message.reply(r);
    return;
  }

  // Toxic about 5head
  const is5headInsult = lower.match(/\b(5head|5headnn|streamer)\b/) &&
    lower.match(/\b(bad|trash|noob|nn|sucks|terrible|worst|crap|cheater)\b/);

  if (is5headInsult) {
    setCooldown(message.author.id);
    const r = await askClaude(`${userStatus} Discord member ${message.author.username} is being toxic about 5HeadNN: "${content}". Defend 5head, Welsh Valleys style. Short and spicy.`, message.channel.id);
    if (r) await message.reply(r);
    return;
  }

  // Rust questions
  const isRustQ = lower.includes('?') &&
    lower.match(/\b(raid|bp|blueprint|craft|farm|base|wipe|loot|weapon|gun|meta|rocket|c4|sulfur|scrap|rust)\b/);

  if (isRustQ) {
    setCooldown(message.author.id);
    const r = await askClaude(`${userStatus} Discord member ${message.author.username} asks: "${content}"`, message.channel.id);
    if (r) await message.reply(r);
  }
});

// ─────────────────────────────────────────
//  EXPORT GO LIVE FUNCTION
// ─────────────────────────────────────────
async function announceGoLive() {
  if (!generalChannel || liveMessageSent) return;
  liveMessageSent = true;

  const embed = new EmbedBuilder()
    .setColor(0x53fc18)
    .setTitle('5HeadNN is LIVE on Kick!')
    .setDescription('EU\'s finest stand sprayer is back. Come watch the most sus Rust gameplay on the internet.')
    .addFields(
      { name: 'Watch Live', value: 'https://kick.com/5headnn', inline: true },
    )
    .setFooter({ text: 'powered by SheepSync' })
    .setTimestamp();

  const target = client.liveChannel || generalChannel;
  await target.send({ content: '@everyone 5head is live!', embeds: [embed] });
  console.log('📢 Discord live announcement sent');

  // Reset after stream
  setTimeout(() => { liveMessageSent = false; }, 8 * 60 * 60 * 1000);
}

client.login(process.env.DISCORD_TOKEN);
module.exports = { announceGoLive };
