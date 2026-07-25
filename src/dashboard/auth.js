const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('../db/database');

// True once an admin account exists, whether created via /signup or
// pre-provisioned through ADMIN_PASSWORD / ADMIN_PASSWORD_HASH in the env.
function adminExists() {
  return !!db.getAdminAccount() || !!config.adminPasswordHash;
}

function verifyLogin(username, password) {
  const cleanUsername = (username || '').trim();

  // Env-provisioned credentials take priority: if you set ADMIN_PASSWORD /
  // ADMIN_PASSWORD_HASH, that's a deliberate, recent action and should always
  // work — even if a /signup account was created earlier (e.g. by accident).
  if (config.adminPasswordHash) {
    if (cleanUsername !== config.adminUsername) return false;
    return bcrypt.compareSync(password, config.adminPasswordHash);
  }

  const account = db.getAdminAccount();
  if (account) {
    if (cleanUsername !== account.username) return false;
    return bcrypt.compareSync(password, account.password_hash);
  }

  throw new Error('No admin account configured yet. Visit /signup to create one.');
}

function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  if (!adminExists()) return res.redirect('/signup');
  return res.redirect('/login');
}

module.exports = { verifyLogin, requireAuth, adminExists };
