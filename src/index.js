require('./db/database'); // ensures data dirs + schema exist before anything else runs

const config = require('./config');
const connection = require('./baileys/connection');
const monitor = require('./baileys/monitor');
const { createServer } = require('./dashboard/server');

async function main() {
  if (!config.adminPasswordHash) {
    console.warn('\n⚠️  No ADMIN_PASSWORD_HASH set in .env — run "npm run create-admin" to create your dashboard login.\n');
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
