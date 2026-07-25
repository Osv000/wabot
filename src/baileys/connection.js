const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const { EventEmitter } = require('events');
const pino = require('pino');
const config = require('../config');

// Central event bus so the dashboard and command handler can react to bot events
// without directly depending on the socket instance.
const botEvents = new EventEmitter();

let sock = null;
let status = 'disconnected'; // disconnected | connecting | qr | open
let lastQr = null;
let pendingPairingNumber = null;

const logger = pino({ level: 'warn' });

function getSocket() {
  return sock;
}

function getStatus() {
  return { status, qr: lastQr, phone: sock?.user?.id || null };
}

async function startConnection() {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ['Personal Bot', 'Chrome', '1.0.0'],
    generateHighQualityLinkPreview: true,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      lastQr = qr;
      status = 'qr';
      botEvents.emit('qr', qr);
    }

    // Request a pairing code once we hit the connecting state, if the user asked for one
    if ((connection === 'connecting' || qr) && pendingPairingNumber && !sock.authState.creds.registered) {
      try {
        const code = await sock.requestPairingCode(pendingPairingNumber);
        botEvents.emit('pairing-code', code);
      } catch (err) {
        botEvents.emit('pairing-error', err.message);
      } finally {
        pendingPairingNumber = null;
      }
    }

    if (connection === 'open') {
      status = 'open';
      lastQr = null;
      botEvents.emit('status', getStatus());
    }

    if (connection === 'close') {
      status = 'disconnected';
      const statusCode = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output?.statusCode
        : lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      botEvents.emit('status', getStatus());
      if (shouldReconnect) {
        setTimeout(() => startConnection().catch((e) => botEvents.emit('error', e)), 2000);
      } else {
        botEvents.emit('logged-out');
      }
    }
  });

  sock.ev.on('messages.upsert', (payload) => {
    botEvents.emit('messages.upsert', payload);
  });

  sock.ev.on('group-participants.update', (payload) => {
    botEvents.emit('group-participants.update', payload);
  });

  return sock;
}

// Called from the dashboard "link with phone number" form
async function requestPairingCode(phoneNumber) {
  const cleaned = phoneNumber.replace(/[^0-9]/g, '');
  if (!cleaned) throw new Error('Invalid phone number');

  if (sock && sock.authState.creds.registered) {
    throw new Error('Already linked to a WhatsApp account. Log out first to relink.');
  }

  if (sock && (status === 'connecting' || status === 'qr')) {
    // socket already trying to connect, just attach the number
    const code = await sock.requestPairingCode(cleaned);
    return code;
  }

  // Not connected yet: store the number and (re)start the connection,
  // the connection.update handler above will request the code once ready.
  pendingPairingNumber = cleaned;
  if (!sock) {
    await startConnection();
  }
  return new Promise((resolve, reject) => {
    const onCode = (code) => {
      botEvents.off('pairing-error', onError);
      resolve(code);
    };
    const onError = (msg) => {
      botEvents.off('pairing-code', onCode);
      reject(new Error(msg));
    };
    botEvents.once('pairing-code', onCode);
    botEvents.once('pairing-error', onError);
  });
}

async function sendMessage(jid, content) {
  if (!sock) throw new Error('Bot is not connected yet');
  return sock.sendMessage(jid, content);
}

async function logout() {
  if (sock) {
    try { await sock.logout(); } catch (e) { /* ignore */ }
  }
  status = 'disconnected';
  sock = null;
}

module.exports = {
  botEvents,
  startConnection,
  requestPairingCode,
  getSocket,
  getStatus,
  sendMessage,
  logout,
};
