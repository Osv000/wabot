const sharp = require('sharp');
const config = require('../config');
const { askAI } = require('./ai');
const { getQuoted, downloadQuotedMedia } = require('./media');
const { isSenderGroupAdmin, resolveTargetJid, isOwner } = require('./groupUtils');
const viewOnce = require('./viewOnce');
const db = require('../db/database');

const startedAt = Date.now();
const activeReminders = new Map(); // id -> Timeout, in-memory only (cleared on restart)

function parseDuration(str) {
  const m = /^(\d+)(s|m|h)?$/i.exec(str || '');
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = (m[2] || 'm').toLowerCase();
  const mult = unit === 's' ? 1000 : unit === 'h' ? 3600000 : 60000;
  return n * mult;
}

// ---------------------------------------------------------------------------
// Each command receives (sock, msg, args, ctx) where ctx = { isOwner, senderNumber, quoted }
// and returns either a string reply, or nothing if it handled its own reply.
// ---------------------------------------------------------------------------
const commands = {
  // ---- General ----
  async help(sock, msg, args) {
    const p = config.commandPrefix;
    const groups = {
      General: ['help', 'ping', 'id', 'stats'],
      AI: ['ai <prompt>', 'translate <lang> <text>'],
      'View-once': ['vv', 'vvmode on|off (owner)', 'save (reply to media)'],
      Media: ['sticker (reply to image)', 'toimg (reply to sticker)', 'forward <number> (reply to msg)'],
      Group: ['groupinfo', 'tagall', 'kick', 'promote', 'demote', 'antilink on|off', 'welcome on|off'],
      Personal: ['note add|list|del', 'remind <10m> <text>', 'profile <number>', 'block', 'unblock'],
      Owner: ['mute', 'unmute'],
    };
    return Object.entries(groups)
      .map(([section, cmds]) => `*${section}*\n` + cmds.map((c) => `${p}${c}`).join('\n'))
      .join('\n\n');
  },

  async ping() {
    return 'pong 🏓';
  },

  async id(sock, msg) {
    return `Chat ID: ${msg.key.remoteJid}`;
  },

  async stats() {
    const uptimeMin = Math.floor((Date.now() - startedAt) / 60000);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayCount = db.countMessagesSince(today.getTime());
    return [
      `Uptime: ${uptimeMin} min`,
      `Messages logged today: ${todayCount}`,
      `Chats tracked: ${db.listChats().length}`,
      `View-once saved: ${db.listViewOnce(100000).length}`,
    ].join('\n');
  },

  // ---- AI ----
  async ai(sock, msg, args) {
    const prompt = args.join(' ').trim();
    if (!prompt) return `Usage: ${config.commandPrefix}ai <your question>`;
    try {
      return await askAI(prompt);
    } catch (err) {
      return `AI error: ${err.message}`;
    }
  },

  async translate(sock, msg, args) {
    const lang = args[0];
    const text = args.slice(1).join(' ');
    if (!lang || !text) return `Usage: ${config.commandPrefix}translate <language> <text>`;
    try {
      return await askAI(`Translate the following text to ${lang}. Reply with only the translation, nothing else:\n\n${text}`);
    } catch (err) {
      return `AI error: ${err.message}`;
    }
  },

  // ---- View-once ----
  async vv(sock, msg, args, ctx) {
    if (!ctx.isOwner) return 'This command is restricted to the bot owner.';
    const items = db.listViewOnce(5);
    if (!items.length) return 'No view-once media saved yet.';
    return items
      .map((v, i) => `${i + 1}. [${v.media_type}] from ${v.sender_name} at ${new Date(v.timestamp).toLocaleString()} — ${v.media_path}`)
      .join('\n') + '\n\nOpen the dashboard "View Once" tab to download the files.';
  },

  async vvmode(sock, msg, args, ctx) {
    if (!ctx.isOwner) return 'This command is restricted to the bot owner.';
    const choice = (args[0] || '').toLowerCase();
    if (choice !== 'on' && choice !== 'off') {
      return `Auto-forward of view-once media to your chat is currently ${viewOnce.getAutoForward() ? 'ON' : 'OFF'}.\nUsage: ${config.commandPrefix}vvmode on|off`;
    }
    viewOnce.setAutoForward(choice === 'on');
    return `Auto-forward of view-once media is now ${choice.toUpperCase()}.`;
  },

  // Reply to ANY media message (view-once, image, video, document, sticker, audio)
  // with .save and the bot forwards a copy straight to your own chat.
  async save(sock, msg, args, ctx) {
    const quoted = ctx.quoted;
    if (!quoted) return `Reply to a photo, video, or other media message with ${config.commandPrefix}save.`;
    if (!config.ownerNumber) return 'Set OWNER_NUMBER in your .env first so I know where to save this.';

    const media = await downloadQuotedMedia(sock, quoted);
    if (!media) return "That message doesn't contain saveable media.";

    const ownerJid = `${config.ownerNumber}@s.whatsapp.net`;
    const caption = `Saved from ${msg.pushName || ctx.senderNumber}`;
    const contentMap = {
      image: { image: media.buffer, caption },
      video: { video: media.buffer, caption },
      audio: { audio: media.buffer, mimetype: 'audio/mp4' },
      sticker: { sticker: media.buffer },
      document: { document: media.buffer, mimetype: 'application/octet-stream', fileName: 'saved-file' },
    };
    await sock.sendMessage(ownerJid, contentMap[media.type]);
    return ownerJid === msg.key.remoteJid ? 'Saved.' : 'Saved to your personal chat.';
  },

  // ---- Media tools ----
  async sticker(sock, msg, args, ctx) {
    const quoted = ctx.quoted;
    if (!quoted) return `Reply to an image with ${config.commandPrefix}sticker.`;
    const media = await downloadQuotedMedia(sock, quoted);
    if (!media || media.type !== 'image') return 'Reply to an image to convert it into a sticker.';
    try {
      const webp = await sharp(media.buffer)
        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp()
        .toBuffer();
      await sock.sendMessage(msg.key.remoteJid, { sticker: webp }, { quoted: msg });
    } catch (err) {
      return `Couldn't create sticker: ${err.message}`;
    }
  },

  async toimg(sock, msg, args, ctx) {
    const quoted = ctx.quoted;
    if (!quoted) return `Reply to a sticker with ${config.commandPrefix}toimg.`;
    const media = await downloadQuotedMedia(sock, quoted);
    if (!media || media.type !== 'sticker') return 'Reply to a sticker to convert it into an image.';
    try {
      const png = await sharp(media.buffer).png().toBuffer();
      await sock.sendMessage(msg.key.remoteJid, { image: png }, { quoted: msg });
    } catch (err) {
      return `Couldn't convert sticker: ${err.message}`;
    }
  },

  async forward(sock, msg, args, ctx) {
    const quoted = ctx.quoted;
    if (!quoted) return `Reply to a message with ${config.commandPrefix}forward <number>.`;
    if (!args[0]) return `Usage: ${config.commandPrefix}forward <number>`;
    const targetJid = `${args[0].replace(/[^0-9]/g, '')}@s.whatsapp.net`;

    const media = await downloadQuotedMedia(sock, quoted);
    if (media) {
      const contentMap = {
        image: { image: media.buffer },
        video: { video: media.buffer },
        audio: { audio: media.buffer, mimetype: 'audio/mp4' },
        sticker: { sticker: media.buffer },
        document: { document: media.buffer, mimetype: 'application/octet-stream', fileName: 'forwarded-file' },
      };
      await sock.sendMessage(targetJid, contentMap[media.type]);
    } else {
      const text = quoted.message.conversation || quoted.message.extendedTextMessage?.text;
      if (!text) return "That message can't be forwarded (unsupported type).";
      await sock.sendMessage(targetJid, { text });
    }
    return `Forwarded to ${args[0]}.`;
  },

  // ---- Group management ----
  async groupinfo(sock, msg) {
    if (!msg.key.remoteJid.endsWith('@g.us')) return 'This command only works in groups.';
    const meta = await sock.groupMetadata(msg.key.remoteJid);
    return [
      `*${meta.subject}*`,
      meta.desc ? meta.desc : '(no description)',
      `Participants: ${meta.participants.length}`,
      `Created: ${new Date(meta.creation * 1000).toLocaleDateString()}`,
    ].join('\n');
  },

  async tagall(sock, msg, args) {
    const jid = msg.key.remoteJid;
    if (!jid.endsWith('@g.us')) return 'This command only works in groups.';
    const meta = await sock.groupMetadata(jid);
    const mentions = meta.participants.map((p) => p.id);
    const text = (args.join(' ') || 'attention everyone') + '\n\n' + mentions.map((m) => `@${m.split('@')[0]}`).join(' ');
    await sock.sendMessage(jid, { text, mentions });
  },

  async kick(sock, msg, args, ctx) {
    return groupModAction(sock, msg, args, ctx, 'remove', 'kicked');
  },
  async promote(sock, msg, args, ctx) {
    return groupModAction(sock, msg, args, ctx, 'promote', 'promoted');
  },
  async demote(sock, msg, args, ctx) {
    return groupModAction(sock, msg, args, ctx, 'demote', 'demoted');
  },

  async antilink(sock, msg, args, ctx) {
    const jid = msg.key.remoteJid;
    if (!jid.endsWith('@g.us')) return 'This command only works in groups.';
    if (!ctx.isOwner && !(await isSenderGroupAdmin(sock, jid, msg.key.participant || jid))) {
      return 'Only group admins or the bot owner can change this.';
    }
    const choice = (args[0] || '').toLowerCase();
    if (choice !== 'on' && choice !== 'off') {
      const cur = db.getChatSettings(jid).antilink;
      return `Antilink is currently ${cur ? 'ON' : 'OFF'}.\nUsage: ${config.commandPrefix}antilink on|off`;
    }
    db.setChatSetting(jid, 'antilink', choice === 'on');
    return `Antilink is now ${choice.toUpperCase()}. Links posted by non-admins will be removed (requires the bot to be a group admin).`;
  },

  async welcome(sock, msg, args, ctx) {
    const jid = msg.key.remoteJid;
    if (!jid.endsWith('@g.us')) return 'This command only works in groups.';
    if (!ctx.isOwner && !(await isSenderGroupAdmin(sock, jid, msg.key.participant || jid))) {
      return 'Only group admins or the bot owner can change this.';
    }
    const choice = (args[0] || '').toLowerCase();
    if (choice !== 'on' && choice !== 'off') {
      const cur = db.getChatSettings(jid).welcome;
      return `Welcome messages are currently ${cur ? 'ON' : 'OFF'}.\nUsage: ${config.commandPrefix}welcome on|off`;
    }
    db.setChatSetting(jid, 'welcome', choice === 'on');
    return `Welcome messages are now ${choice.toUpperCase()}.`;
  },

  // ---- Personal / contact ----
  async profile(sock, msg, args) {
    if (!args[0]) return `Usage: ${config.commandPrefix}profile <number>`;
    const jid = `${args[0].replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    let pic = 'none, or private';
    try { pic = await sock.profilePictureUrl(jid, 'image'); } catch { /* private or not found */ }
    let statusText = null;
    try { statusText = (await sock.fetchStatus(jid))?.status; } catch { /* private or not found */ }
    return [`Profile photo: ${pic}`, statusText ? `About: ${statusText}` : null].filter(Boolean).join('\n');
  },

  async block(sock, msg, args, ctx) {
    if (!ctx.isOwner) return 'Owner only.';
    if (!args[0]) return `Usage: ${config.commandPrefix}block <number>`;
    const jid = `${args[0].replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    await sock.updateBlockStatus(jid, 'block');
    return `Blocked ${args[0]}.`;
  },

  async unblock(sock, msg, args, ctx) {
    if (!ctx.isOwner) return 'Owner only.';
    if (!args[0]) return `Usage: ${config.commandPrefix}unblock <number>`;
    const jid = `${args[0].replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    await sock.updateBlockStatus(jid, 'unblock');
    return `Unblocked ${args[0]}.`;
  },

  async note(sock, msg, args, ctx) {
    if (!ctx.isOwner) return 'Owner only.';
    const sub = (args[0] || '').toLowerCase();
    const owner = ctx.senderNumber;
    if (sub === 'add') {
      const content = args.slice(1).join(' ');
      if (!content) return `Usage: ${config.commandPrefix}note add <text>`;
      const id = db.addNote(owner, content);
      return `Saved as note #${id}.`;
    }
    if (sub === 'list') {
      const notes = db.listNotes(owner);
      if (!notes.length) return 'No notes yet.';
      return notes.map((n) => `#${n.id} — ${n.content}`).join('\n');
    }
    if (sub === 'del') {
      const id = parseInt(args[1], 10);
      if (!id) return `Usage: ${config.commandPrefix}note del <id>`;
      return db.deleteNote(owner, id) ? `Deleted note #${id}.` : `No note #${id}.`;
    }
    return `Usage: ${config.commandPrefix}note add|list|del ...`;
  },

  async remind(sock, msg, args, ctx) {
    const durationMs = parseDuration(args[0]);
    const text = args.slice(1).join(' ');
    if (!durationMs || !text) return `Usage: ${config.commandPrefix}remind <10m|30s|2h> <text>`;
    if (durationMs > 24 * 3600 * 1000) return 'Max reminder window is 24h.';

    const chatId = msg.key.remoteJid;
    const timer = setTimeout(async () => {
      try { await sock.sendMessage(chatId, { text: `Reminder: ${text}` }); } catch { /* chat may be gone */ }
      activeReminders.delete(timer);
    }, durationMs);
    activeReminders.set(timer, { chatId, text });

    return `Okay, I'll remind you in ${args[0]}. (Reminders are in-memory and reset if the bot restarts.)`;
  },

  // ---- Owner: per-chat mute ----
  async mute(sock, msg, args, ctx) {
    if (!ctx.isOwner) return 'Owner only.';
    db.setChatSetting(msg.key.remoteJid, 'muted', true);
    return 'Commands are now muted in this chat (except !unmute).';
  },

  async unmute(sock, msg, args, ctx) {
    if (!ctx.isOwner) return 'Owner only.';
    db.setChatSetting(msg.key.remoteJid, 'muted', false);
    return 'Commands are unmuted in this chat.';
  },
};

async function groupModAction(sock, msg, args, ctx, action, pastTense) {
  const jid = msg.key.remoteJid;
  if (!jid.endsWith('@g.us')) return 'This command only works in groups.';
  if (!ctx.isOwner && !(await isSenderGroupAdmin(sock, jid, msg.key.participant || jid))) {
    return 'Only group admins or the bot owner can do that.';
  }
  const target = resolveTargetJid(msg, args, ctx.quoted);
  if (!target) return `Reply to the person's message, @mention them, or pass their number with ${config.commandPrefix}${action}.`;
  try {
    await sock.groupParticipantsUpdate(jid, [target], action);
    return `${target.split('@')[0]} ${pastTense}.`;
  } catch (err) {
    return `Failed: ${err.message}. (The bot account must be a group admin for this to work.)`;
  }
}

function parseCommand(text) {
  const prefix = config.commandPrefix;
  if (!text || !text.startsWith(prefix)) return null;
  const [cmd, ...args] = text.slice(prefix.length).trim().split(/\s+/);
  return { cmd: (cmd || '').toLowerCase(), args };
}

async function handleCommand(sock, msg, text) {
  const parsed = parseCommand(text);
  if (!parsed || !commands[parsed.cmd]) return false;

  const senderNumber = (msg.key.participant || msg.key.remoteJid || '').split('@')[0];
  const ctx = {
    isOwner: isOwner(senderNumber),
    senderNumber,
    quoted: getQuoted(msg),
  };

  // Respect per-chat mute, except for the unmute command itself and owner override
  const settings = db.getChatSettings(msg.key.remoteJid);
  if (settings.muted && parsed.cmd !== 'unmute' && !ctx.isOwner) return true;

  try {
    const reply = await commands[parsed.cmd](sock, msg, parsed.args, ctx);
    if (reply) {
      await sock.sendMessage(msg.key.remoteJid, { text: reply }, { quoted: msg });
    }
  } catch (err) {
    await sock.sendMessage(msg.key.remoteJid, { text: `Error running command: ${err.message}` }, { quoted: msg });
  }
  return true;
}

module.exports = { handleCommand, commands };
