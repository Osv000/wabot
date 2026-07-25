const path = require('path');
const express = require('express');
const session = require('express-session');
const QRCode = require('qrcode');
const config = require('../config');
const { verifyLogin, requireAuth } = require('./auth');
const connection = require('../baileys/connection');
const db = require('../db/database');

function createServer() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use('/static', express.static(path.join(__dirname, 'public')));
  app.use('/media', requireAuthOr401, express.static(config.mediaDir));

  app.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 },
    })
  );

  function requireAuthOr401(req, res, next) {
    if (req.session && req.session.loggedIn) return next();
    return res.status(401).send('Unauthorized');
  }

  // ---- Auth ----
  app.get('/login', (req, res) => {
    if (req.session.loggedIn) return res.redirect('/');
    res.render('login', { error: null });
  });

  app.post('/login', (req, res) => {
    const { username, password } = req.body;
    try {
      if (verifyLogin(username, password)) {
        req.session.loggedIn = true;
        return res.redirect('/');
      }
      return res.render('login', { error: 'Invalid username or password.' });
    } catch (err) {
      return res.render('login', { error: err.message });
    }
  });

  app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  });

  // ---- Home / link page (this is the site's homepage) ----
  app.get('/', requireAuth, (req, res) => {
    res.render('home', { status: connection.getStatus() });
  });

  app.get('/api/status', requireAuth, async (req, res) => {
    const status = connection.getStatus();
    let qrImage = null;
    if (status.qr) {
      qrImage = await QRCode.toDataURL(status.qr);
    }
    res.json({ ...status, qrImage });
  });

  app.post('/api/link', requireAuth, async (req, res) => {
    try {
      const code = await connection.requestPairingCode(req.body.phone || '');
      res.json({ code });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---- Dashboard ----
  app.get('/dashboard', requireAuth, (req, res) => {
    res.render('dashboard', {
      status: connection.getStatus(),
      chatCount: db.listChats().length,
      messageCount: db.listRecentMessages(100000).length,
      viewOnceCount: db.listViewOnce(100000).length,
      recent: db.listRecentMessages(30),
    });
  });

  app.get('/dashboard/chats', requireAuth, (req, res) => {
    res.render('chats', { status: connection.getStatus(), chats: db.listChats() });
  });

  app.get('/dashboard/chat/:id', requireAuth, (req, res) => {
    const chatId = req.params.id;
    res.render('chat', {
      status: connection.getStatus(),
      chatId,
      messages: db.listMessages(chatId, 300),
    });
  });

  app.get('/dashboard/viewonce', requireAuth, (req, res) => {
    res.render('viewonce', { status: connection.getStatus(), items: db.listViewOnce(60) });
  });

  app.get('/dashboard/send', requireAuth, (req, res) => {
    res.render('send', { status: connection.getStatus(), prefillTo: req.query.to || '', result: null, error: null });
  });

  app.post('/dashboard/send', requireAuth, async (req, res) => {
    const { to, text } = req.body;
    let result = null;
    let error = null;
    try {
      const jid = to.includes('@') ? to : `${to.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
      await connection.sendMessage(jid, { text });
      result = `Message sent to ${to}.`;
    } catch (err) {
      error = err.message;
    }
    res.render('send', { status: connection.getStatus(), prefillTo: to, result, error });
  });

  // JSON API for recent messages, useful if you want to poll for a live view
  app.get('/api/messages', requireAuth, (req, res) => {
    const chatId = req.query.chat;
    const rows = chatId ? db.listMessages(chatId, 200) : db.listRecentMessages(100);
    res.json(rows);
  });

  return app;
}

module.exports = { createServer };
