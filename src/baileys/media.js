const { downloadMediaMessage } = require('@whiskeysockets/baileys');

// Returns a message-like object for whatever the user's message was quoting/replying to,
// or null if it wasn't a reply.
function getQuoted(msg) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo || msg.message?.imageMessage?.contextInfo;
  if (!ctx?.quotedMessage) return null;
  return {
    key: {
      remoteJid: msg.key.remoteJid,
      id: ctx.stanzaId,
      participant: ctx.participant,
      fromMe: false,
    },
    message: ctx.quotedMessage,
    pushName: msg.pushName,
  };
}

function mediaTypeOf(message) {
  if (!message) return null;
  if (message.imageMessage) return 'image';
  if (message.videoMessage) return 'video';
  if (message.audioMessage) return 'audio';
  if (message.stickerMessage) return 'sticker';
  if (message.documentMessage) return 'document';
  // unwrap view-once containers too, so .save works on a quoted view-once notice
  const inner = message.viewOnceMessageV2Extension?.message || message.viewOnceMessageV2?.message || message.viewOnceMessage?.message;
  if (inner) return mediaTypeOf(inner);
  return null;
}

async function downloadQuotedMedia(sock, quotedMsg) {
  const inner =
    quotedMsg.message.viewOnceMessageV2Extension?.message ||
    quotedMsg.message.viewOnceMessageV2?.message ||
    quotedMsg.message.viewOnceMessage?.message ||
    quotedMsg.message;

  const type = mediaTypeOf(quotedMsg.message);
  if (!type) return null;

  const buffer = await downloadMediaMessage(
    { ...quotedMsg, message: inner },
    'buffer',
    {},
    { reuploadRequest: sock.updateMediaMessage }
  );
  return { type, buffer };
}

module.exports = { getQuoted, mediaTypeOf, downloadQuotedMedia };
