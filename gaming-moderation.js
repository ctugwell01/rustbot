'use strict';

// Dedicated moderation for the gaming Discord. The existing EvilSheep server
// continues to use its original Discord handlers in discord.js.
const { PermissionFlagsBits } = require('discord.js');
const GAMING_GUILD_ID = '1540790437508546700';
const WARNING_WINDOW_MS = 15 * 60 * 1000;
const PING_TIMEOUT_MS = 5 * 60 * 1000;
const MENTION_SPAM_WINDOW_MS = 15 * 60 * 1000;
const MENTION_SPAM_TIMEOUT_MS = 5 * 60 * 1000;
const MOD_LOG_CHANNEL_ID = '1563588138738262036';
const warnings = new Map();
const mentionSpam = new Map();
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

function isBanAppeal(content) {
  return [
    /\bwhy\s+(?:am|was)\s+i\s+bann?ed\b/i,
    /\b(?:i\s+(?:got|was)|got)\s+bann?ed\b/i,
    /\b(?:can|could|will|would)\s+(?:i|you)\s+(?:get\s+)?unbann?ed\b/i,
    /\bunbann?\s+me\b/i,
    /\bban\s+appeal\b/i,
    /\bappeal(?:ing)?\s+(?:my\s+)?ban\b/i,
    /\bbann?ed\s+(?:for\s+)?no\s+reason\b/i,
  ].some(pattern => pattern.test(content));
}


function isPlayerReport(content) {
  return [
    /\b(?:this|that)\s+(?:guy|player|dude|kid)\b.{0,40}\b(?:cheat(?:ing|er)?|hack(?:ing|er)?|aimbot|wallhack|esp)\b/i,
    /\b(?:he|she|they)\b.{0,30}\b(?:is|are|'s|re)\b.{0,15}\b(?:cheat(?:ing)?|hack(?:ing)?|using\s+(?:aimbot|wallhack|esp))\b/i,
    /\b(?:report|reporting)\s+(?:a\s+|this\s+|that\s+)?(?:player|cheater|hacker|admin|mod(?:erator)?)\b/i,
    /\b(?:need|want)\s+to\s+report\s+(?:someone|a\s+player|an?\s+admin|an?\s+mod(?:erator)?)\b/i,
    /\b(?:admin|mod(?:erator)?)\s+abuse\b/i,
    /\b(?:cheater|hacker)\s+report\b/i,
  ].some(pattern => pattern.test(content));
}

function isStaffMember(member, guildOwnerId) {
  if (!member) return false;
  return member.id === guildOwnerId ||
    Boolean(member.permissions?.has?.(PermissionFlagsBits.Administrator)) ||
    Boolean(member.permissions?.has?.(PermissionFlagsBits.ManageGuild)) ||
    Boolean(member.permissions?.has?.(PermissionFlagsBits.ModerateMembers)) ||
    Boolean(member.roles?.cache?.some(role => staffRoleNames.has(role.name.toLowerCase())));
}

function countStaffMentions(message) {
  let count = 0;

  for (const match of message.content.matchAll(/<@!?(\d+)>/g)) {
    const id = match[1];
    const user = message.mentions.users.get(id);
    const member = message.mentions.members?.get(id);
    if (
      id === message.guild.ownerId ||
      protectedNames.has(normalise(user?.username)) ||
      protectedNames.has(normalise(user?.globalName)) ||
      protectedNames.has(normalise(member?.displayName)) ||
      isStaffMember(member, message.guild.ownerId)
    ) {
      count++;
    }
  }

  for (const match of message.content.matchAll(/<@&(\d+)>/g)) {
    const role = message.mentions.roles.get(match[1]);
    const roleName = normalise(role?.name);
    if (protectedNames.has(roleName) || staffRoleNames.has(String(role?.name || '').toLowerCase())) {
      count++;
    }
  }

  const typed = message.content.match(/(^|\s)@(owner|5headnn|staff|admins?|administrators?|mods?|moderators?)(?=\s|$|[.,!?])/gi);
  count += typed?.length || 0;
  return count;
}

function recordMentionSpam(message) {
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  const old = mentionSpam.get(key);
  const record = old && now - old.firstAt < MENTION_SPAM_WINDOW_MS
    ? { firstAt: old.firstAt, count: old.count + 1 }
    : { firstAt: now, count: 1 };
  mentionSpam.set(key, record);
  return { key, record };
}

function extractUrls(content) {
  return String(content || '').match(/https?:\/\/[^\s<>()]+/gi) || [];
}

function scamLinkReason(content) {
  const text = String(content || '');
  const inviteMatches = text.match(/(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/gi) || [];
  if (inviteMatches.length >= 2 || (inviteMatches.length === 1 && (text.trim().length < 120 || /\b(?:join|server|giveaway|free|nitro|check\s+out|come\s+join|dm\s+me)\b/i.test(text)))) {
    return 'Discord invite spam';
  }

  const shorteners = new Set(['bit.ly', 'tinyurl.com', 'cutt.ly', 'rebrand.ly', 'is.gd', 'rb.gy', 'shorturl.at', 'tiny.one', 'ow.ly']);
  const officialDiscord = host => host === 'discord.com' || host.endsWith('.discord.com') || host === 'discord.gift' || host.endsWith('.discord.gift');
  const officialSteam = host =>
    host === 'steamcommunity.com' || host.endsWith('.steamcommunity.com') ||
    host === 'steampowered.com' || host.endsWith('.steampowered.com');

  for (const raw of extractUrls(text)) {
    try {
      const cleaned = raw.replace(/[),.!?]+$/, '');
      const host = new URL(cleaned).hostname.toLowerCase().replace(/^www\./, '');

      if (shorteners.has(host)) return `Suspicious shortened URL (${host})`;

      if (!officialDiscord(host) &&
          /(discord|nitro)/i.test(host) &&
          /\b(?:nitro|gift|free|claim|login|discord)\b/i.test(`${text} ${host}`)) {
        return `Possible fake Discord/Nitro link (${host})`;
      }

      if (!officialSteam(host) &&
          /(?:steamcommunity|steampowered|steam-login|steamlogin|steam-gift|steamgift|steamtrade|steam-trade)/i.test(host)) {
        return `Possible fake Steam link (${host})`;
      }
    } catch (_) {}
  }

  return null;
}

function ticketChannelLink(guild) {
  const candidates = ['ticket', 'tickets', 'support', 'support-ticket', 'support-tickets', 'open-a-ticket', 'create-ticket'];
  const channel = guild.channels.cache.find(ch =>
    ch.isTextBased?.() && candidates.includes(ch.name?.toLowerCase())
  );
  return channel ? `<#${channel.id}>` : '#ticket';
}

function suggestedChannel(content) {
  if (isBanAppeal(content)) return 'ticket';
  if (/\b(bug|bugs|glitch|glitches|exploit|broken feature|fault)\b/i.test(content)) return 'bugs';
  if (/\b(suggest|suggestion|idea|feedback|feature request)\b/i.test(content)) return 'suggestions';
  if (/\b(gamemode|game mode|mode change|rotation|mode update)\b/i.test(content)) return 'gamemode-changes';
  if (/\b(server status|server online|server offline|uptime|online|offline|player count|server up|server down|status)\b/i.test(content)) return 'server-status';
  if (/\b(rule|rules|allowed|against the rules)\b/i.test(content)) return 'rules';
  if (/\b(announcement|announcements|news|official update)\b/i.test(content)) return 'announcements';
  return 'members-channel';
}

function isStaff(message) {
  return message.author.id === message.guild.ownerId ||
    isStaffMember(message.member, message.guild.ownerId);
}

function channelLink(guild, name) {
  const channel = guild.channels.cache.find(ch => ch.name?.toLowerCase() === name && ch.isTextBased());
  return channel ? `<#${channel.id}>` : `#${name}`;
}


async function sendModLog(message, details) {
  const modLogChannel = message.guild.channels.cache.get(MOD_LOG_CHANNEL_ID);
  if (!modLogChannel?.isTextBased?.()) {
    console.warn(`Gaming Discord mod-log channel unavailable: ${MOD_LOG_CHANNEL_ID}`);
    return;
  }

  const original = String(details.originalContent || '').replace(/\s+/g, ' ').trim().slice(0, 500) || '(empty message)';
  const sourceChannel = message.channel?.id ? `<#${message.channel.id}>` : 'unknown channel';
  const deleteStatus = details.deleted ? 'Deleted' : 'Delete failed / unavailable';
  const timeoutStatus = details.timedOut ? '5-minute timeout applied' : `Warning ${details.warningCount}/3`;

  try {
    await modLogChannel.send({
      content:
        `🛡️ **SheepSync owner-ping moderation**\n` +
        `**Member:** <@${message.author.id}> (\`${message.author.username}\`, ID \`${message.author.id}\`)\n` +
        `**Channel:** ${sourceChannel}\n` +
        `**Original:** ${original}\n` +
        `**Redirect:** ${details.target}\n` +
        `**Message:** ${deleteStatus}\n` +
        `**Action:** ${timeoutStatus}`,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error('Gaming Discord mod-log send failed:', error.message);
  }
}


async function sendSecurityLog(message, details) {
  const modLogChannel = message.guild.channels.cache.get(MOD_LOG_CHANNEL_ID);
  if (!modLogChannel?.isTextBased?.()) return;

  const original = String(details.originalContent || message.content || '').replace(/\s+/g, ' ').trim().slice(0, 500) || '(empty message)';
  const sourceChannel = message.channel?.id ? `<#${message.channel.id}>` : 'unknown channel';

  try {
    await modLogChannel.send({
      content:
        `🛡️ **${details.title}**\n` +
        `**Member:** <@${message.author.id}> (\`${message.author.username}\`, ID \`${message.author.id}\`)\n` +
        `**Channel:** ${sourceChannel}\n` +
        `**Original:** ${original}\n` +
        (details.target ? `**Redirect:** ${details.target}\n` : '') +
        (details.reason ? `**Reason:** ${details.reason}\n` : '') +
        `**Action:** ${details.action}`,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error('Gaming Discord security log send failed:', error.message);
  }
}

async function handleGamingMessage(message) {
  if (message.guildId !== GAMING_GUILD_ID || message.author.bot) return false;

  const staffMember = isStaff(message);

  // Clear abuse first: two or more staff/owner mentions in one message, or
  // three separate tagging messages within 15 minutes, results in a 5-minute
  // timeout. Genuine server incidents with one owner ping are not counted.
  if (!staffMember) {
    const staffMentionCount = countStaffMentions(message);
    if (staffMentionCount > 0 && !(staffMentionCount === 1 && isSeriousServerIssue(message.content))) {
      const { key, record } = recordMentionSpam(message);
      const excessiveNow = staffMentionCount >= 2;
      const repeated = record.count >= 3;

      if (excessiveNow || repeated) {
        const originalContent = message.content;
        let deleted = false;
        let timedOut = false;

        if (message.deletable) {
          try {
            await message.delete();
            deleted = true;
          } catch (error) {
            console.error('Gaming Discord mention-spam delete failed:', error.message);
          }
        }

        if (message.member?.moderatable) {
          try {
            await message.member.timeout(MENTION_SPAM_TIMEOUT_MS, 'Repeated/excessive staff or owner mention spam');
            timedOut = true;
          } catch (error) {
            console.error('Gaming Discord mention-spam timeout failed:', error.message);
          }
        }

        mentionSpam.delete(key);
        warnings.delete(key);

        try {
          await message.channel.send({
            content: `🐑 <@${message.author.id}> don't spam staff/owner mentions. ${timedOut ? 'You have been timed out for 5 minutes.' : 'A timeout could not be applied, but the message was removed.'}`,
            allowedMentions: { parse: [] },
          });
        } catch (error) {
          console.error('Gaming Discord mention-spam notice failed:', error.message);
        }

        await sendSecurityLog(message, {
          title: 'Mention-spam protection',
          originalContent,
          reason: excessiveNow ? `${staffMentionCount} staff/owner mentions in one message` : `${record.count} tagging messages within 15 minutes`,
          action: `${deleted ? 'Message deleted' : 'Delete unavailable'}; ${timedOut ? '5-minute timeout applied' : 'timeout unavailable'}; no ban`,
        });
        return true;
      }
    }

    const scamReason = scamLinkReason(message.content);
    if (scamReason) {
      const originalContent = message.content;
      let deleted = false;
      if (message.deletable) {
        try {
          await message.delete();
          deleted = true;
        } catch (error) {
          console.error('Gaming Discord scam-link delete failed:', error.message);
        }
      }

      try {
        await message.channel.send({
          content: `🐑 <@${message.author.id}> suspicious/invite links aren't allowed here. If you need staff to review a link, use ${ticketChannelLink(message.guild)}.`,
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        console.error('Gaming Discord scam-link notice failed:', error.message);
      }

      await sendSecurityLog(message, {
        title: 'Scam/link protection',
        originalContent,
        reason: scamReason,
        target: ticketChannelLink(message.guild),
        action: deleted ? 'Message deleted and logged; no ban' : 'Delete unavailable; event logged; no ban',
      });
      return true;
    }

    if (isPlayerReport(message.content)) {
      const target = ticketChannelLink(message.guild);
      const protectedPing = isProtectedPing(message);
      const originalContent = message.content;
      let deleted = false;

      if (protectedPing && message.deletable) {
        try {
          await message.delete();
          deleted = true;
        } catch (error) {
          console.error('Gaming Discord player-report owner-ping delete failed:', error.message);
        }
      }

      const payload = {
        content: `🐑 <@${message.author.id}> player reports, cheating reports and admin-abuse reports go through ${target}. Please include the player's **Steam ID** and a **clip/video if possible** so staff can review it.`,
        allowedMentions: { parse: [] },
      };

      try {
        if (deleted) {
          await message.channel.send(payload);
        } else {
          await message.reply({ ...payload, allowedMentions: { parse: [], repliedUser: false } });
        }
      } catch (error) {
        console.error('Gaming Discord player-report redirect failed:', error.message);
      }

      await sendSecurityLog(message, {
        title: 'Player/report redirect',
        originalContent,
        target,
        reason: 'Cheating/player/admin-abuse report',
        action: `${deleted ? 'Owner/staff ping removed; ' : ''}redirected to ticket; no timeout or ban`,
      });
      return true;
    }
  }

  // Ban/unban questions should go through the ticket system, even if the user
  // did not ping staff. This is informational only: no warnings or timeouts.
  if (isBanAppeal(message.content) && !staffMember) {
    const target = ticketChannelLink(message.guild);
    const protectedPing = isProtectedPing(message);
    let deleted = false;

    if (protectedPing && message.deletable) {
      try {
        await message.delete();
        deleted = true;
        console.log(`🗑️ Deleted owner ping from ban-appeal message by ${message.author.username}`);
      } catch (error) {
        console.error('Gaming Discord ban-appeal owner-ping delete failed:', error.message);
      }
    }

    try {
      const payload = {
        content: `🐑 <@${message.author.id}> ban and unban questions need to go through ${target}. Open a ticket there and the staff team can review it.`,
        allowedMentions: { parse: [] },
      };
      if (deleted) {
        await message.channel.send(payload);
      } else {
        await message.reply({ ...payload, allowedMentions: { parse: [], repliedUser: false } });
      }
    } catch (error) {
      console.error('Gaming Discord ban-appeal redirect failed:', error.message);
    }

    return true;
  }

  // Simple connection test, available to owners and ordinary members alike.
  if (/^!sheepsync(?:\s+status)?\s*$/i.test(message.content)) {
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

  const originalContent = message.content;
  const target = channelLink(message.guild, suggestedChannel(message.content));
  let deleted = false;

  // Remove routine owner pings from chat before posting the redirect. Serious
  // server issues and staff messages return above and are never deleted.
  if (message.deletable) {
    try {
      await message.delete();
      deleted = true;
      console.log(`🗑️ Deleted unnecessary owner ping from ${message.author.username} in gaming Discord`);
    } catch (error) {
      console.error('Gaming Discord owner-ping delete failed:', error.message);
    }
  } else {
    console.warn('Gaming Discord cannot delete owner ping — grant SheepSync Manage Messages.');
  }

  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  const old = warnings.get(key);
  const record = old && now - old.firstAt < WARNING_WINDOW_MS
    ? { firstAt: old.firstAt, count: old.count + 1 }
    : { firstAt: now, count: 1 };
  warnings.set(key, record);

  let timeoutText = '';
  let timedOut = false;
  // Three unnecessary pings within 15 minutes counts as persistent ping spam.
  if (record.count >= 3) {
    if (message.member?.moderatable) {
      try {
        await message.member.timeout(PING_TIMEOUT_MS, 'Repeated unnecessary owner/5HeadNN pings after warnings');
        timeoutText = ' You have been timed out for 5 minutes for repeatedly pinging the owner.';
        timedOut = true;
        warnings.delete(key);
      } catch (error) {
        console.error('Gaming Discord owner-ping timeout failed:', error.message);
      }
    } else {
      console.warn('Gaming Discord cannot timeout member (missing permissions or hierarchy).');
    }
  }

  try {
    await message.channel.send({
      content: `🐑 <@${message.author.id}> please don't ping @Owner or @5HeadNN for routine questions. Use ${target} instead, or ask the admins. Owner pings are for serious server outages or technical issues only.${timeoutText}`,
      // Render the member reference without creating another notification.
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error('Gaming Discord owner-ping redirect failed:', error.message);
  }

  await sendModLog(message, {
    originalContent,
    target,
    deleted,
    timedOut,
    warningCount: record.count,
  });

  return true;
}

module.exports = {
  GAMING_GUILD_ID,
  MOD_LOG_CHANNEL_ID,
  handleGamingMessage,
  isProtectedPing,
  isSeriousServerIssue,
  isBanAppeal,
  isPlayerReport,
  scamLinkReason,
  countStaffMentions,
  ticketChannelLink,
  suggestedChannel,
};
