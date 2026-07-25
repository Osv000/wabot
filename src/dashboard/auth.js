const bcrypt = require('bcryptjs');
const config = require('../config');

function verifyLogin(username, password) {
  if (!config.adminPasswordHash) {
    throw new Error('No admin account configured yet. Run "npm run create-admin" first.');
  }
  if (username !== config.adminUsername) return false;
  return bcrypt.compareSync(password, config.adminPasswordHash);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  return res.redirect('/login');
}

module.exports = { verifyLogin, requireAuth };
