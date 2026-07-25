// Usage: npm run create-admin
// Prompts for a password, hashes it with bcrypt, and prints the line to paste
// into your .env file as ADMIN_PASSWORD_HASH.
const readline = require('readline');
const bcrypt = require('bcryptjs');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('Choose an admin password: ', (password) => {
  if (!password || password.length < 6) {
    console.log('Password must be at least 6 characters.');
    rl.close();
    process.exit(1);
  }
  const hash = bcrypt.hashSync(password, 10);
  console.log('\nAdd this to your .env file:\n');
  console.log(`ADMIN_PASSWORD_HASH=${hash}\n`);
  rl.close();
});
