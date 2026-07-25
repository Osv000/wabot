require('dotenv').config();
const path = require('path');

const DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR || './data');

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  sessionSecret: process.env.SESSION_SECRET || 'insecure-dev-secret-change-me',

adminUsername: (process.env.ADMIN_USERNAME || 'admin').trim(),
  adminPasswordHash: (process.env.ADMIN_PASSWORD_HASH || '').trim(),
  adminPassword: (process.env.ADMIN_PASSWORD || '').trim(),

  commandPrefix: process.env.COMMAND_PREFIX || '!',
  ownerNumber: (process.env.OWNER_NUMBER || '').replace(/[^0-9]/g, ''),
  autoForwardViewOnce: (process.env.AUTO_FORWARD_VIEWONCE || 'true').toLowerCase() !== 'false',

  aiProvider: (process.env.AI_PROVIDER || 'anthropic').toLowerCase(),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',

  dataDir: DATA_DIR,
  authDir: path.join(DATA_DIR, 'auth_info_baileys'),
  mediaDir: path.join(DATA_DIR, 'media'),
  viewOnceDir: path.join(DATA_DIR, 'media', 'viewonce'),
  dbPath: path.join(DATA_DIR, 'bot.sqlite'),
};
