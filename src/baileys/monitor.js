const { botEvents, getSocket } = require('./connection');
const { tryHandleViewOnce } = require('./viewOnce');
const { handleCommand } = require('./commands');
const { isSenderGroupAdmin } = require('./groupUtils');
const { insertMessage, upsertChat, getChatSettings } = require('../db/database');

const LINK_RE = /https?:\/\/\S+|wa\.me\/\S+/i;
let attached = false;

function extractText(message) {
  if (!message) return '';
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    ''
  );
}

function detectType(message) {
  if (!message) return 'unknown';
  if (message.conversation || message.extendedTextMessage) return 'text';
  if (message.imageMessage) return 'image';
  if (message.videoMessage) return 'video';
  if (message.audioMessage) return 'audio';
  if (message.documentMessage) return 'document';
  if (message.stickerMessage) return 'sticker';
  if (message.viewOnceMessage || message.viewOnceMessageV2 || message.viewOnceMessageV2Extension) return 'view_once';
  return 'other';
}

function attach() {
  if (attached) return; // safe to call multiple times; only wires the listener once
  attached = true;

  botEvents.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const sock = getSocket();
    if (!sock) return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const chatId = msg.key.remoteJid;
      const isGroup = chatId.endsWith('@g.us');
      const senderId = msg.key.participant || chatId;
      const senderName = msg.pushName || senderId;
      const msgType = detectType(msg.message);
      const text = extractText(msg.message);
      const timestamp = (Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000)) * 1000;

      // 1. Save view-once media before it disappears
      let isViewOnce = false;
      if (msgType === 'view_once') {
        isViewOnce = await tryHandleViewOnce(sock, msg);
        botEvents.emit('view-once-saved', { chatId, senderName });
      }

      // 2. Log every message for the "monitor" dashboard view
      insertMessage({
        msg_id: msg.key.id || null,
        chat_id: chatId,
        chat_name: isGroup ? (msg.key.remoteJid) : senderName,
        is_group: isGroup ? 1 : 0,
        sender_id: senderId,
        sender_name: senderName,
        from_me: msg.key.fromMe ? 1 : 0,
        msg_type: msgType,
        body: text,
        media_path: null,
        is_view_once: isViewOnce ? 1 : 0,
        timestamp,
      });

      upsertChat(chatId, isGroup ? chatId : senderName, isGroup, text || `[${msgType}]`, timestamp);
      botEvents.emit('new-message', { chatId, senderName, text, msgType, fromMe: msg.key.fromMe });

      // 3. Antilink: delete links from non-admins in groups where it's enabled
      if (isGroup && !msg.key.fromMe && text && LINK_RE.test(text)) {
        const settings = getChatSettings(chatId);
        if (settings.antilink) {
          const senderIsAdmin = await isSenderGroupAdmin(sock, chatId, senderId);
          if (!senderIsAdmin) {
            try {
              await sock.sendMessage(chatId, { delete: msg.key });
              await sock.sendMessage(chatId, { text: `Removed a link from @${senderId.split('@')[0]} (antilink is on).`, mentions: [senderId] });
            } catch (err) {
              console.error('Antilink delete failed (is the bot a group admin?):', err.message);
            }
            continue; // don't also treat the link text as a command
          }
        }
      }

      // 4. Dispatch commands (skip messages we sent ourselves)
      if (!msg.key.fromMe && text) {
        await handleCommand(sock, msg, text);
      }
    }
  });

  // Welcome new members in groups that opted in with !welcome on
  botEvents.on('group-participants.update', async ({ id: groupJid, participants, action }) => {
    if (action !== 'add') return;
    const settings = getChatSettings(groupJid);
    if (!settings.welcome) return;
    const sock = getSocket();
    if (!sock) return;
    try {
      const meta = await sock.groupMetadata(groupJid);
      for (const p of participants) {
        await sock.sendMessage(groupJid, {
          text: `Welcome @${p.split('@')[0]} to ${meta.subject}! 👋`,
          mentions: [p],
        });
      }
    } catch (err) {
      console.error('Failed to send welcome message:', err.message);
    }
  });
}

module.exports = { attach };
