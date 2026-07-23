const fs = require('fs');
const path = require('path');

const targetFiles = [
  'package.json',
  'apps/web/package.json',
  'apps/api/package.json',
  'packages/shared/package.json'
];

console.log('🔍 Starting package.json diagnostic and repair...\n');

targetFiles.forEach((relativePath) => {
  const filePath = path.join(process.cwd(), relativePath);

  if (!fs.existsSync(filePath)) {
    console.log(`⚠️ File not found (skipping): ${relativePath}`);
    return;
  }

  try {
    let rawContent = fs.readFileSync(filePath, 'utf8');

    // Remove invisible non-breaking space characters (\u00A0)
    if (rawContent.includes('\u00A0')) {
      console.log(`🧹 Removing hidden non-breaking spaces in: ${relativePath}`);
      rawContent = rawContent.replace(/\u00A0/g, ' ');
    }

    const parsedData = JSON.parse(rawContent);

    // Ensure 'version' is a valid semver string
    if (!parsedData.version || typeof parsedData.version !== 'string' || parsedData.version.trim() === '') {
      console.log(`🔧 Fixing invalid or missing version field in: ${relativePath}`);
      parsedData.version = '1.0.0';
    } else {
      parsedData.version = parsedData.version.trim();
    }

    const formattedJson = JSON.stringify(parsedData, null, 2) + '\n';
    fs.writeFileSync(filePath, formattedJson, 'utf8');

    console.log(`✅ ${relativePath} is clean and valid (version: "${parsedData.version}")`);
  } catch (error) {
    console.error(`❌ Error parsing ${relativePath}:`, error.message);
  }
});

console.log('\n✨ Diagnostic complete!');
