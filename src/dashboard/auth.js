const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('../db/database');

// True once an admin account exists, whether created via /signup or
// pre-provisioned through ADMIN_PASSWORD / ADMIN_PASSWORD_HASH in the env.
function adminExists() {
  return !!db.getAdminAccount() || !!config.adminPasswordHash;
}

function verifyLogin(username, password) {
  const account = db.getAdminAccount();
  if (account) {
    if (username !== account.username) return false;
    return bcrypt.compareSync(password, account.password_hash);
  }
  // Fall back to the env-provisioned admin (legacy path / non-interactive hosts)
  if (!config.adminPasswordHash) {
    throw new Error('No admin account configured yet. Visit /signup to create one.');
  }
  if (username !== config.adminUsername) return false;
  return bcrypt.compareSync(password, config.adminPasswordHash);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  if (!adminExists()) return res.redirect('/signup');
  return res.redirect('/login');
}

module.exports = { verifyLogin, requireAuth, adminExists };
