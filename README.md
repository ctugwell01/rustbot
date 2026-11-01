# RustBot — kick.com/5headnn

AI-powered Rust expert chatbot for your Kick stream.

---

## ⚡ Quick Setup (5 steps)

### 1. Install Node.js
Download from https://nodejs.org (get the LTS version)

### 2. Download & set up the bot
Unzip the bot folder, open a terminal inside it and run:
```
npm install
```

### 3. Get your Anthropic API Key
1. Go to https://console.anthropic.com/settings/keys
2. Click "Create Key"
3. Copy the key

### 4. Get your Kick Auth Token
This lets the bot send messages as you.

1. Open Chrome/Firefox and go to https://kick.com
2. Log in to your account
3. Press **F12** to open DevTools
4. Go to the **Application** tab (Chrome) or **Storage** tab (Firefox)
5. Click **Cookies** → **https://kick.com**
6. Find the cookie named **`kick_session`** or **`token`** — copy its value
7. Also copy the **`XSRF-TOKEN`** cookie value

> ⚠️ These tokens expire. If the bot stops sending messages, repeat this step.

### 5. Create your .env file
Copy `.env.example` to `.env`:
```
cp .env.example .env
```
Then open `.env` and paste in your keys:
```
ANTHROPIC_API_KEY=sk-ant-...your key...
KICK_AUTH_TOKEN=...your kick token...
KICK_XSRF_TOKEN=...your xsrf token...
```

---

## ▶️ Running the bot

```bash
node bot.js
```

Or with auto-restart on crash:
```bash
npm run dev
```

You should see:
```
✅ Connected to channel: 5headnn (Chatroom ID: XXXXX)
📡 Listening on chatroom XXXXX...
🎮 RustBot is active!
```

---

## 💬 Commands viewers can use

| Command | What it does |
|---------|-------------|
| `!raid [wall type]` | Cheapest raid cost |
| `!bp [item]` | Blueprint cost & scrap |
| `!meta` | Current weapon meta |
| `!loot [monument]` | Monument loot info |
| `!wipe` | Wipe schedule info |
| `!farm [resource]` | Best farming tips |
| `!base [size]` | Base building advice |
| `!discord` | Your Discord link |
| `!lurk` | Lurk acknowledgement |

---

## ⚙️ Customising the bot

Open `bot.js` and edit the `CONFIG` section at the top:

```js
const CONFIG = {
  channelSlug: '5headnn',        // Your channel
  streamerName: '5HeadNN',       // Your display name
  botPrefix: '🤖 RustBot →',     // Change bot prefix
  commandPrefix: '!',            // Change command trigger
  welcomeEnabled: true,          // Toggle welcome message
  autoAnswerQuestions: true,     // Toggle auto Rust answers
  greetNewChatters: true,        // Toggle new chatter greets
  cooldownSeconds: 5,            // Anti-spam cooldown
};
```

To add a static command, add to `STATIC_COMMANDS`:
```js
'!clip': '🎬 Check clips at kick.com/5headnn/clips',
```

---

## 🔧 Troubleshooting

**Bot connects but won't send messages:**
→ Your `KICK_AUTH_TOKEN` is wrong or expired. Re-grab it from browser cookies.

**"Failed to fetch channel info":**
→ Kick API may be down, or check your internet connection.

**Bot responds but sends weird messages:**
→ Check your `ANTHROPIC_API_KEY` is valid.

**Tokens expire often?**
→ Consider using a dedicated Kick bot account so you stay logged in permanently.

---

## 📦 Files

```
rustbot-5headnn/
├── bot.js          ← Main bot script
├── .env            ← Your secret keys (never share!)
├── .env.example    ← Template
├── package.json    ← Dependencies
└── README.md       ← This file
```


## 🛡️ Automatic growth-scam moderation

The bot now detects unsolicited stream-growth pitches by combining signals like
promotion offers, community placement, follower/viewer targets, earnings promises,
and requests to move to Discord or another messaging platform. It also considers
up to five messages from the same viewer over two minutes, so scammers cannot
evade detection just by splitting a pitch across several chat messages.

The built-in checks run locally (no per-message AI requests or new credentials).
A follow alone does **not** exempt anyone from moderation. Streamer, mod, and
VIP accounts are protected from automatic spam bans.

Automatic bans still require valid Kick moderation authorization: check Railway
logs for `BAN CONFIRMED` or `BAN FAILED`. If unauthorized, authorize
SheepSyncBot at `/mod-auth` with the `moderation:ban` scope.

Before changing moderation rules, run:

```bash
npm test
npm run check
```

The regression tests include real scam samples and normal chat messages to
help prevent missed scams and accidental bans.


## 5HeadNN's Arena Discord: FAQ and moderation

The gaming guild uses the rules in gaming-moderation.js through the existing SheepSync bot (discord.js). Unlike the EvilSheep Discord, these channel answers are deterministic and do not need an Anthropic key.

- Short natural-language questions about suggestions, bugs, tickets, rules, gamemode changes, announcements, server status and leaving Rust gamemodes get helpful responses. Channel links use the guild's existing visible channels; a missing/private channel is not invented. Replies are rate limited.
- Non-owner/non-administrator Discord invite links (discord.gg, discord.com/invite, discordapp.com/invite), fake Nitro/Steam links and common URL shorteners are removed and logged. This also applies to users with a moderator role but no Administrator permission.
- Non-owner/non-administrator members also cannot post ordinary external links in public Arena chat, including genuine Steam Community profile links. Such posts are deleted and logged without timeouts or bans. Genuine Steam profile and evidence links are allowed in private ticket/support channels (named ticket-* or support-*) **only when the @everyone role cannot view the channel**. Suspicious links and Discord invites remain prohibited there. The owner and actual Administrators are exempt.
- Any non-owner/non-administrator who types @everyone or @here has the message removed and receives a five-minute Discord timeout if the bot has permission. The server owner and members with the actual Administrator permission are exempt; a moderator role or Manage Messages alone is not an exemption. Actions are logged without triggering further mentions.
- Existing ticket redirections, owner-ping protection, ban appeals and other rules are retained.

In Discord server/role settings, disable "Mention @everyone, @here, and All Roles" for ordinary roles. Give SheepSync Manage Messages, Moderate Members, View Channel and Send Messages in relevant channels, and put its bot role above roles it may timeout. Discord won't let a bot timeout the server owner, administrators or members with an equal/higher role. Review audit entries in the existing moderation log channel.

Test in the Arena Discord with a normal member account using a question such as "is there a suggestion tab" and a harmless @everyone attempt. Check the actual timeout, deletion and log channel; changing GitHub code alone does not grant Discord permissions.

## Automatic Arena scam handling

SheepSync now watches **5HeadNN's Arena Discord** messages, but never reads users' private DMs.
Besides the ordinary link rules, it automatically:

- Removes Discord invites and known phishing/URL-shortener patterns for non-admins.
- Removes unsolicited credential requests, verification QR-code instructions, fake gift/prize promotions, guaranteed-return solicitations, and dangerous executable/script attachments.
- Issues a 10-minute timeout for high-confidence credential theft, verification QR-code prompts and dangerous executables **in public chat**, if Discord allows moderation of that member. Lower-confidence giveaways are deleted and logged without immediate timeout.
- Counts blocked links/scam posts per user. Three within ten minutes trigger a 5-minute timeout. This counter is reset when Railway restarts.
- Defangs quoted URLs and mass mentions in staff moderation logs so scam links are not reposted as clickable bait.
- Allows ordinary players to post legitimate Steam evidence in verified private ticket channels; dangerous attachments and Discord invitations remain blocked.

All actions are logged. The bot **never automatically permanently bans users**. The bot cannot see member DMs, scan the contents of images/QR codes, inspect files, or guarantee all scams are caught. Keep Discord's built-in AutoMod, verification, onboarding/rules screening and staff-reporting channels enabled. Grant SheepSync Manage Messages, Timeout Members and appropriate role hierarchy. Test with a normal member account and review false positives in the moderation log.


## Chat with SheepSync in 5HeadNN's Arena Discord

Arena uses the existing Groq key from the Railway rustbot service (GROQ_API_KEY), the same key used by the Kick chatbot. No new bot account, plugin, or Anthropic key is needed.

Talk to SheepSync in Arena Discord in any of these ways:
- Mention the bot: @SheepSync how do I get better at Rust?
- Type a direct address: SheepSync, how's it going?
- Use a command: !ask what's the best way to practise recoil? (also !ai and !chat)
- Reply to a message SheepSync sent to continue that conversation.

The bot responds only to explicit prompts, not every message. Its existing Arena moderation, scam removal, ban appeals and channel FAQs are handled **before** AI chat. It will not answer content the moderation rules deleted or redirected. The main EvilSheep Discord retains its existing behaviour.

This is a friendly conversational assistant, not a Discord administrator or a substitute for staff. It cannot change server permissions, jail players, or inspect game/Discord server state. It shouldn't invent official rules, population figures or staff decisions. Questions and up to six recent dialogue messages per member and channel are sent to Groq for a response. Conversations are stored in memory and reset on a bot restart. Messages do not include private DMs. A per-user eight-second cooldown, 700-character input limit, and a small concurrent-request limit help prevent API abuse. Replies disable Discord mentions.

If replies fail: confirm the Railway rustbot service has GROQ_API_KEY configured, the Groq API works, and the bot has View Channel/Send Messages/Read Message History and Message Content Intent enabled. Check deploy logs for "Arena AI chat failed" (without posting secret tokens). Groq API usage may have provider limits or charges; monitor the existing provider account. 
