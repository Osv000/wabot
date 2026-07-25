const config = require('../config');

async function isSenderGroupAdmin(sock, groupJid, senderJid) {
  try {
    const meta = await sock.groupMetadata(groupJid);
    const participant = meta.participants.find((p) => p.id === senderJid);
    return !!participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
  } catch {
    return false;
  }
}

// Resolves the target of a group-admin command: an @mention, a quoted message's author,
// or a raw number passed as an argument.
function resolveTargetJid(msg, args, quoted) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  if (mentioned && mentioned.length) return mentioned[0];
  if (quoted?.key?.participant) return quoted.key.participant;
  if (args[0]) {
    const digits = args[0].replace(/[^0-9]/g, '');
    if (digits) return `${digits}@s.whatsapp.net`;
  }
  return null;
}

function isOwner(senderNumber) {
  return !!config.ownerNumber && senderNumber === config.ownerNumber;
}

module.exports = { isSenderGroupAdmin, resolveTargetJid, isOwner };
