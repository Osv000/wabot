require('./db/database'); // ensures data dirs + schema exist before anything else runs

const bcrypt = require('bcryptjs');
const config = require('./config');
const connection = require('./baileys/connection');
const monitor = require('./baileys/monitor');
const { createServer } = require('./dashboard/server');

async function main() {
  if (!config.adminPasswordHash && config.adminPassword) {
    // No shell access on this host (e.g. Render free tier) to run the interactive
    // create-admin script — hash the plain ADMIN_PASSWORD env var at boot instead.
    config.adminPasswordHash = bcrypt.hashSync(config.adminPassword, 10);
    console.log('🔑 Derived admin login from ADMIN_PASSWORD env var at startup.');
  }

  if (!config.adminPasswordHash) {
    console.warn('\n⚠️  No admin login configured — set ADMIN_PASSWORD (or ADMIN_PASSWORD_HASH) in your environment.\n');
  }

  monitor.attach();
  connection.botEvents.on('status', (s) => {
    if (s.status === 'open') console.log(`✅ WhatsApp connected as ${s.phone}`);
  });

  await connection.startConnection();

  const app = createServer();
  app.listen(config.port, () => {
    console.log(`🖥️  Dashboard running at http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error('Fatal error starting bot:', err);
  process.exit(1);
});
