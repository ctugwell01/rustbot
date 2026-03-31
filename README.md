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
