const fs = require('fs');
const path = require('path');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const config = require('../config');
const { insertViewOnce } = require('../db/database');

// Unwraps the various shapes a "view once" message can arrive in across
// Baileys/WhatsApp protocol versions (viewOnceMessage, viewOnceMessageV2,
// viewOnceMessageV2Extension, or a plain message with a viewOnce flag set).
function extractViewOnceContent(message) {
  if (!message) return null;

  const wrapper =
    message.viewOnceMessageV2Extension?.message ||
    message.viewOnceMessageV2?.message ||
    message.viewOnceMessage?.message;

  if (wrapper) return wrapper;

  // Some clients send image/video messages directly with viewOnce: true
  const direct = message.imageMessage || message.videoMessage;
  if (direct?.viewOnce) return message;

  return null;
}

function getMediaTypeAndCaption(innerMessage) {
  if (innerMessage.imageMessage) {
    return { type: 'image', caption: innerMessage.imageMessage.caption || '' };
  }
  if (innerMessage.videoMessage) {
    return { type: 'video', caption: innerMessage.videoMessage.caption || '' };
  }
  return { type: 'unknown', caption: '' };
}

// Runtime toggle for auto-forwarding (owner can flip this with !vvmode, starts from .env)
let autoForwardEnabled = config.autoForwardViewOnce;
function setAutoForward(enabled) { autoForwardEnabled = enabled; }
function getAutoForward() { return autoForwardEnabled; }

async function forwardToOwner(sock, buffer, type, caption) {
  if (!config.ownerNumber) return;
  const ownerJid = `${config.ownerNumber}@s.whatsapp.net`;
  const content = type === 'image' ? { image: buffer, caption } : { video: buffer, caption };
  try {
    await sock.sendMessage(ownerJid, content);
  } catch (err) {
    console.error('Failed to forward view-once to owner chat:', err.message);
  }
}

async function tryHandleViewOnce(sock, msg) {
  const content = extractViewOnceContent(msg.message);
  if (!content) return false;

  const { type, caption } = getMediaTypeAndCaption(content);
  if (type === 'unknown') return false;

  try {
    const buffer = await downloadMediaMessage(
      { ...msg, message: content },
      'buffer',
      {},
      { logger: undefined, reuploadRequest: sock.updateMediaMessage }
    );

    const ext = type === 'image' ? 'jpg' : 'mp4';
    const filename = `${Date.now()}_${msg.key.id || 'unknown'}.${ext}`;
    const filepath = path.join(config.viewOnceDir, filename);
    fs.writeFileSync(filepath, buffer);

    const chatId = msg.key.remoteJid;
    const senderId = msg.key.participant || msg.key.remoteJid;
    const senderName = msg.pushName || senderId;

    insertViewOnce({
      msg_id: msg.key.id || null,
      chat_id: chatId,
      chat_name: msg.pushName || chatId,
      sender_id: senderId,
      sender_name: senderName,
      media_type: type,
      media_path: path.relative(config.dataDir, filepath),
      caption,
      timestamp: Date.now(),
    });

    if (autoForwardEnabled) {
      const label = `👁️ View-once ${type} from ${senderName}${caption ? `\n\n"${caption}"` : ''}`;
      await forwardToOwner(sock, buffer, type, label);
    }

    return true;
  } catch (err) {
    console.error('Failed to save view-once media:', err.message);
    return false;
  }
}

module.exports = { tryHandleViewOnce, extractViewOnceContent, setAutoForward, getAutoForward, forwardToOwner };
