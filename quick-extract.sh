#!/bin/bash
# Quick extraction script - run this from your repo root

# Install adm-zip if needed
npm install adm-zip 2>/dev/null

# Extract all zip files
node << 'EOF'
const fs = require('fs');
const AdmZip = require('adm-zip');

const zipFiles = fs.readdirSync('.').filter(f => f.endsWith('.zip'));
console.log(`Found ${zipFiles.length} zip file(s)\n`);

zipFiles.forEach(file => {
  try {
    console.log(`📦 Extracting: ${file}`);
    new AdmZip(file).extractAllTo('./', true);
    console.log(`✅ Done: ${file}\n`);
  } catch (e) {
    console.error(`❌ Error with ${file}:`, e.message);
  }
});

console.log('All done! Extracted files are in your repo.');
EOF

# Commit the changes
git add -A
git commit -m "Extract: Added extracted zip contents"
git push
