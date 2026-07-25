const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.mediaDir, { recursive: true });
fs.mkdirSync(config.viewOnceDir, { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  msg_id TEXT,
  chat_id TEXT NOT NULL,
  chat_name TEXT,
  is_group INTEGER NOT NULL DEFAULT 0,
  sender_id TEXT,
  sender_name TEXT,
  from_me INTEGER NOT NULL DEFAULT 0,
  msg_type TEXT,
  body TEXT,
  media_path TEXT,
  is_view_once INTEGER NOT NULL DEFAULT 0,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);

CREATE TABLE IF NOT EXISTS view_once (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  msg_id TEXT,
  chat_id TEXT NOT NULL,
  chat_name TEXT,
  sender_id TEXT,
  sender_name TEXT,
  media_type TEXT,
  media_path TEXT NOT NULL,
  caption TEXT,
  timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  chat_id TEXT PRIMARY KEY,
  chat_name TEXT,
  is_group INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER,
  last_message_preview TEXT
);

CREATE TABLE IF NOT EXISTS chat_settings (
  chat_id TEXT PRIMARY KEY,
  antilink INTEGER NOT NULL DEFAULT 0,
  welcome INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Singleton table: id is always 1, so a second INSERT can never succeed.
-- That's what makes signup "close" permanently and race-safely once used.
CREATE TABLE IF NOT EXISTS admin_account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

function insertMessage(row) {
  const stmt = db.prepare(`
    INSERT INTO messages (msg_id, chat_id, chat_name, is_group, sender_id, sender_name, from_me, msg_type, body, media_path, is_view_once, timestamp)
    VALUES (@msg_id, @chat_id, @chat_name, @is_group, @sender_id, @sender_name, @from_me, @msg_type, @body, @media_path, @is_view_once, @timestamp)
  `);
  stmt.run(row);
}

function upsertChat(chatId, chatName, isGroup, preview, timestamp) {
  db.prepare(`
    INSERT INTO chats (chat_id, chat_name, is_group, last_message_at, last_message_preview)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      chat_name = excluded.chat_name,
      is_group = excluded.is_group,
      last_message_at = excluded.last_message_at,
      last_message_preview = excluded.last_message_preview
  `).run(chatId, chatName, isGroup ? 1 : 0, timestamp, preview);
}

function insertViewOnce(row) {
  const stmt = db.prepare(`
    INSERT INTO view_once (msg_id, chat_id, chat_name, sender_id, sender_name, media_type, media_path, caption, timestamp)
    VALUES (@msg_id, @chat_id, @chat_name, @sender_id, @sender_name, @media_type, @media_path, @caption, @timestamp)
  `);
  stmt.run(row);
}

function listChats() {
  return db.prepare(`SELECT * FROM chats ORDER BY last_message_at DESC`).all();
}

function listMessages(chatId, limit = 200) {
  return db.prepare(`SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?`).all(chatId, limit);
}

function listRecentMessages(limit = 100) {
  return db.prepare(`SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?`).all(limit);
}

function listViewOnce(limit = 100) {
  return db.prepare(`SELECT * FROM view_once ORDER BY timestamp DESC LIMIT ?`).all(limit);
}

function getChatSettings(chatId) {
  const row = db.prepare(`SELECT * FROM chat_settings WHERE chat_id = ?`).get(chatId);
  return row || { chat_id: chatId, antilink: 0, welcome: 0, muted: 0 };
}

function setChatSetting(chatId, key, value) {
  if (!['antilink', 'welcome', 'muted'].includes(key)) throw new Error('Unknown setting: ' + key);
  db.prepare(`
    INSERT INTO chat_settings (chat_id, ${key}) VALUES (?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET ${key} = excluded.${key}
  `).run(chatId, value ? 1 : 0);
}

function addNote(ownerId, content) {
  const info = db.prepare(`INSERT INTO notes (owner_id, content, created_at) VALUES (?, ?, ?)`).run(ownerId, content, Date.now());
  return info.lastInsertRowid;
}

function listNotes(ownerId) {
  return db.prepare(`SELECT * FROM notes WHERE owner_id = ? ORDER BY id DESC`).all(ownerId);
}

function deleteNote(ownerId, id) {
  const info = db.prepare(`DELETE FROM notes WHERE owner_id = ? AND id = ?`).run(ownerId, id);
  return info.changes > 0;
}

function countMessagesSince(timestamp) {
  return db.prepare(`SELECT COUNT(*) AS c FROM messages WHERE timestamp >= ?`).get(timestamp).c;
}

function getAdminAccount() {
  return db.prepare(`SELECT * FROM admin_account WHERE id = 1`).get();
}

// INSERT OR IGNORE against the fixed id=1 primary key means only the very
// first call can ever succeed — a second signup attempt (even a concurrent
// one) is rejected at the database level, not just in application logic.
function createAdminAccount(username, passwordHash) {
  const info = db
    .prepare(`INSERT OR IGNORE INTO admin_account (id, username, password_hash, created_at) VALUES (1, ?, ?, ?)`)
    .run(username, passwordHash, Date.now());
  return info.changes > 0;
}

module.exports = {
  db,
  insertMessage,
  upsertChat,
  insertViewOnce,
  listChats,
  listMessages,
  listRecentMessages,
  listViewOnce,
  getChatSettings,
  setChatSetting,
  addNote,
  listNotes,
  deleteNote,
  countMessagesSince,
  getAdminAccount,
  createAdminAccount,
};