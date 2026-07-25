#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

// Find all zip files in the current directory
const files = fs.readdirSync('.');
const zipFiles = files.filter(file => file.endsWith('.zip'));

if (zipFiles.length === 0) {
  console.log('No zip files found.');
  process.exit(0);
}

zipFiles.forEach(zipFile => {
  try {
    console.log(`\nExtracting ${zipFile}...`);
    const zip = new AdmZip(zipFile);
    zip.extractAllTo('./', true);
    console.log(`✓ Successfully extracted ${zipFile}`);
  } catch (error) {
    console.error(`✗ Error extracting ${zipFile}:`, error.message);
  }
});

console.log('\n✓ All zip files have been extracted!');
