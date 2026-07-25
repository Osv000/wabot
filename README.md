# WhatsApp AI Bot + Admin Dashboard (personal use)

A personal WhatsApp automation built on [Baileys](https://baileys.wiki) (`@whiskeysockets/baileys`, the multi-device WhatsApp Web API library). It runs as a second linked device on your own WhatsApp account and gives you:

- **Command bot** in any chat — `!ai`, `!help`, `!ping`, `!id`, `!vv` (extendable)
- **View-once saver** — automatically downloads view-once photos/videos before they disappear
- **Chat & group monitor** — every message is logged to a local SQLite database
- **Send messages** — from the dashboard, to any chat or group
- **Admin web dashboard** with login, whose homepage is the "link WhatsApp by phone number" screen

⚠️ This uses an unofficial API (Baileys), which is against WhatsApp's Terms of Service in the strictest reading. It's widely used for personal/hobby bots, but use your own judgment, keep it to your own account, and don't use it for bulk messaging or spam.

## 1. Install

```bash
cd whatsapp-ai-bot
npm install
cp .env.example .env
```

Node 18+ is required.

## 2. Create your dashboard login

```bash
npm run create-admin
```

This asks for a password, hashes it, and prints a line like:

```
ADMIN_PASSWORD_HASH=$2a$10$....
```

Paste that into `.env`. Set `ADMIN_USERNAME` too if you don't want `admin`.

## 3. Configure `.env`

Key fields:

- `OWNER_NUMBER` — your own number (digits only, country code, no `+`). Restricts owner-only commands like `!vv` to you.
- `COMMAND_PREFIX` — defaults to `!`.
- `AI_PROVIDER` — `anthropic` or `openai`, plus the matching API key (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`). Leave both blank and `!ai` will just return an error telling you to set one.
- `SESSION_SECRET` — any long random string.

## 4. Run it

```bash
npm start
```

Open `http://localhost:3000`. Log in with the admin account you created — the homepage **is** the "link your WhatsApp" screen:

- Enter your phone number and tap **Get pairing code** → open WhatsApp on your phone → **Linked devices → Link with phone number** → type the code shown.
- Or switch to the **QR code** tab and scan it the normal way.

Once linked, the page automatically redirects into the dashboard. Session/auth files are stored in `data/auth_info_baileys` — deleting that folder forces a fresh link.

## 5. Using the bot

The prefix defaults to `!` (set `COMMAND_PREFIX=.` in `.env` if you'd rather type `.save`, `.sticker`, etc.).

### View-once — the `.save` behavior you asked for

Two things work together:

1. **Automatic** — every view-once photo/video sent to the bot is downloaded the instant it arrives (before WhatsApp deletes it) and, by default, a copy is immediately forwarded to your own personal chat (`OWNER_NUMBER`) with a caption saying who sent it. Toggle this anytime with `!vvmode on` / `!vvmode off`, or set `AUTO_FORWARD_VIEWONCE=false` in `.env` to start it off by default.
2. **Manual `!save`** — reply to *any* media message (a view-once notice, a normal photo, video, sticker, document, or voice note — from anyone, in any chat) with `!save` and the bot forwards a copy straight to your own chat on demand.

`!vv` lists the last few captured view-once items (owner-only); the dashboard's **View Once** tab shows the full gallery.

### Full command list

```
General     !help  !ping  !id  !stats
AI          !ai <prompt>                 — ask the AI assistant
            !translate <lang> <text>     — quick translation
View-once   !vv                          — list recently saved view-once media (owner)
            !vvmode on|off               — toggle auto-forward-to-self (owner)
            !save                        — reply to media to forward it to your own chat
Media       !sticker                     — reply to an image to make a sticker
            !toimg                       — reply to a sticker to get the image back
            !forward <number>            — reply to a message to forward it elsewhere
Group       !groupinfo                   — name, description, member count
            !tagall [message]            — mention every member
            !kick / !promote / !demote   — reply to or @mention a member (admin/owner only)
            !antilink on|off             — auto-delete links from non-admins (bot must be a group admin)
            !welcome on|off              — greet new members automatically
Personal    !note add|list|del <text>    — quick personal notes (owner)
            !remind <10m|30s|2h> <text>  — one-off reminder in the current chat
            !profile <number>            — look up a contact's profile photo / about text
            !block / !unblock <number>   — owner only
Owner       !mute / !unmute              — silence bot commands in a specific chat
```

Add new ones in `src/baileys/commands.js` — each command is a small async function `(sock, msg, args, ctx)` that returns the text to reply with; `ctx.quoted` gives you the replied-to message when there is one, and `ctx.isOwner` / `ctx.senderNumber` handle permissions.

### Notes on the group-moderation commands

`!kick`, `!promote`, `!demote`, and `!antilink`'s auto-delete only work if **the bot's own WhatsApp account is an admin of that group** — that's a WhatsApp requirement, not something Baileys can get around. Reminders and in-progress toggles (`!vvmode`, active `!remind` timers) live in memory and reset if you restart the process; everything else (notes, chat settings, message history, view-once files) is in SQLite/disk and survives restarts.

## 6. Dashboard tour

- **Overview** — connection status + recent activity feed
- **Chats** — every chat/group seen, with a per-chat message log
- **View Once** — gallery of auto-saved view-once photos/videos, downloadable
- **Send Message** — send a message to any number or group JID
- **Link / Device** — the homepage; also where you'd relink after a logout

## Project layout

```
src/
  config.js              env/config loader
  index.js               entry point — starts the socket + web server
  baileys/
    connection.js         Baileys socket lifecycle, pairing code, reconnect
    monitor.js             logs messages, wires view-once + commands
    viewOnce.js             detects & downloads view-once media
    commands.js             chat command handlers
    ai.js                   Anthropic/OpenAI request helper
  db/
    database.js            SQLite schema + queries (better-sqlite3)
  dashboard/
    server.js               Express app + routes
    auth.js                 login/session middleware
    createAdmin.js          CLI script to set the dashboard password
    views/                  EJS templates
    public/style.css        dashboard styling
data/                      auth session, sqlite db, saved media (gitignored)
```

## Notes & next steps

- `!sticker`/`!toimg` use `sharp` for image conversion, which installs a prebuilt native binary for most platforms via `npm install`. If that fails on your machine, you may need build tools (`build-essential` on Debian/Ubuntu, Xcode CLI tools on macOS).
- Storage is local SQLite + local files — fine for personal use on one machine. Back up `data/` if you care about history.
- `express-session` uses the default in-memory store, so restarting the server logs the dashboard out. Fine for personal use; swap in `connect-sqlite3` if you want persistence.
- For real-time dashboard updates instead of polling, add `socket.io` and emit on the existing `botEvents` (`new-message`, `view-once-saved`, `status`) — the event bus is already there.
- Keep `data/` and `.env` out of version control (already in `.gitignore`).
