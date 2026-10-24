'use strict';

// Dedicated moderation for the gaming Discord. The existing EvilSheep server
// continues to use its original Discord handlers in discord.js.
const { PermissionFlagsBits } = require('discord.js');
const GAMING_GUILD_ID = '1540790437508546700';
const WARNING_WINDOW_MS = 15 * 60 * 1000;
const PING_TIMEOUT_MS = 5 * 60 * 1000;
const warnings = new Map();
const protectedNames = new Set(['owner', '5headnn']);
const staffRoleNames = new Set(['admin', 'admins', 'administrator', 'administrators', 'mod', 'mods', 'mod.', 'moderator', 'moderators', 'staff']);

function normalise(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isProtectedPing(message) {
  const ids = new Set([...message.content.matchAll(/<@!?(\d+)>/g)].map(match => match[1]));
  const userPing = message.mentions.users.some(user => {
    if (!ids.has(user.id)) return false; // Ignore mentions added by a reply.
    const guildMember = message.mentions.members?.get(user.id);
    return user.id === message.guild.ownerId ||
      protectedNames.has(normalise(user.username)) ||
      protectedNames.has(normalise(user.globalName)) ||
      protectedNames.has(normalise(guildMember?.displayName));
  });
  const rolePing = message.mentions.roles.some(role => protectedNames.has(normalise(role.name)));
  // Also catch people typing literal @Owner / @5HeadNN without a resolved mention.
  const typedPing = /(^|\s)@(owner|5headnn)(?=\s|$|[.,!?])/i.test(message.content);
  return userPing || rolePing || typedPing;
}

function isSeriousServerIssue(content) {
  return [
    /\b(?:server|game|gamemode|host)\b.{0,60}\b(?:down|offline|unavailable|crash(?:ed|ing)?|broken|not working|unresponsive|lagging|outage|issues?|problems?)\b/i,
    /\b(?:down|offline|unavailable|broken|crash(?:ed|ing)?|outage)\b.{0,40}\b(?:server|game|gamemode)\b/i,
    /\b(?:can't|cant|cannot|unable to|won't|wont|failed to)\s+(?:\w+\s+){0,4}(?:connect|join|log ?in|load)\b/i,
    /\b(?:connection refused|connection timed out|server error|server outage|ddos|d[o]?s attack)\b/i,
  ].some(pattern => pattern.test(content));
}

function suggestedChannel(content) {
  if (/\b(bug|bugs|glitch|glitches|exploit|broken feature|fault)\b/i.test(content)) return 'bugs';
  if (/\b(suggest|suggestion|idea|feedback|feature request)\b/i.test(content)) return 'suggestions';
  if (/\b(gamemode|game mode|mode change|rotation|mode update)\b/i.test(content)) return 'gamemode-changes';
  if (/\b(server status|server online|server offline|uptime|online|offline|player count|server up|server down|status)\b/i.test(content)) return 'server-status';
  if (/\b(rule|rules|allowed|against the rules)\b/i.test(content)) return 'rules';
  if (/\b(announcement|announcements|news|official update)\b/i.test(content)) return 'announcements';
  return 'members-channel';
}

function isStaff(message) {
  const member = message.member;
  return message.author.id === message.guild.ownerId ||
    Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator)) ||
    Boolean(member?.permissions?.has(PermissionFlagsBits.ManageGuild)) ||
    Boolean(member?.permissions?.has(PermissionFlagsBits.ModerateMembers)) ||
    Boolean(member?.roles?.cache?.some(role => staffRoleNames.has(role.name.toLowerCase())));
}

function channelLink(guild, name) {
  const channel = guild.channels.cache.find(ch => ch.name?.toLowerCase() === name && ch.isTextBased());
  return channel ? `<#${channel.id}>` : `#${name}`;
}

async function handleGamingMessage(message) {
  if (message.guildId !== GAMING_GUILD_ID || message.author.bot) return false;

  // Simple connection test, available to owners and ordinary members alike.
  if (/^!sheepsync(?:\\s+status)?\\s*$/i.test(message.content)) {
    console.log(`🐑 Gaming Discord diagnostic command received in ${GAMING_GUILD_ID}`);
    try {
      await message.reply({
        content: '🐑 SheepSync is online in this gaming Discord. Owner-ping redirects are enabled. Routine questions go to the correct channel; genuine server outages may ping the owner.',
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (error) {
      console.error('Gaming Discord diagnostic reply failed:', error.message);
    }
    return true;
  }

  if (!isProtectedPing(message)) return false;
  console.log(`🐑 Gaming Discord protected owner ping detected in ${GAMING_GUILD_ID}`);
  if (isStaff(message) || isSeriousServerIssue(message.content)) return true;

  const target = channelLink(message.guild, suggestedChannel(message.content));
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  const old = warnings.get(key);
  const record = old && now - old.firstAt < WARNING_WINDOW_MS
    ? { firstAt: old.firstAt, count: old.count + 1 }
    : { firstAt: now, count: 1 };
  warnings.set(key, record);

  let timeoutText = '';
  // Three unnecessary pings within 15 minutes counts as persistent ping spam.
  if (record.count >= 3) {
    if (message.member?.moderatable) {
      try {
        await message.member.timeout(PING_TIMEOUT_MS, 'Repeated unnecessary owner/5HeadNN pings after warnings');
        timeoutText = ' You have been timed out for 5 minutes for repeatedly pinging the owner.';
        warnings.delete(key);
      } catch (error) {
        console.error('Gaming Discord owner-ping timeout failed:', error.message);
      }
    } else {
      console.warn('Gaming Discord cannot timeout member (missing permissions or hierarchy).');
    }
  }

  try {
    await message.reply({
      content: `🐑 Please don't ping @Owner or @5HeadNN for routine questions. Use ${target} instead, or ask the admins. Owner pings are for serious server outages or technical issues only.${timeoutText}`,
      allowedMentions: { parse: [], repliedUser: false },
    });
  } catch (error) {
    console.error('Gaming Discord owner-ping redirect failed:', error.message);
  }
  return true;
}

module.exports = {
  GAMING_GUILD_ID,
  handleGamingMessage,
  isProtectedPing,
  isSeriousServerIssue,
  suggestedChannel,
};
