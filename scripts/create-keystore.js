/**
 * Keystore Generation Script
 * Creates encrypted keystore files for OZ Relayer using ethers.js
 * Usage: node scripts/create-keystore.js
 */

const { Wallet } = require('ethers');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * Interactive keystore creation
 */
async function createKeystore() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (q) => new Promise(resolve => rl.question(q, resolve));

  try {
    console.log('========================================');
    console.log('OZ Relayer Keystore Generation Script');
    console.log('========================================\n');

    // Get private key
    let privateKey = await question(
      'Enter Private Key (with or without 0x prefix): '
    );

    // Auto-add 0x prefix if missing
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }

    if (privateKey.length !== 66) {
      throw new Error('Invalid private key format. Must be 64 hex characters (32 bytes)');
    }

    // Get keystore password
    const password = await question(
      'Enter Keystore Password (will not be echoed): '
    );

    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }

    // Get output path
    const outputPath = await question(
      'Enter output path (e.g., docker/keys/relayer-1/keystore.json): '
    );

    // Create wallet and encrypt
    console.log('\nEncrypting keystore...');
    const wallet = new Wallet(privateKey);
    let keystore = await wallet.encrypt(password);

    // Fix: ethers.js uses "Crypto" but OZ Relayer expects "crypto" (lowercase)
    const keystoreObj = JSON.parse(keystore);
    if (keystoreObj.Crypto && !keystoreObj.crypto) {
      keystoreObj.crypto = keystoreObj.Crypto;
      delete keystoreObj.Crypto;
      keystore = JSON.stringify(keystoreObj);
    }

    // Create directory if it doesn't exist
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }

    // Write keystore file
    fs.writeFileSync(outputPath, keystore);
    console.log(`\nKeystore created successfully!`);
    console.log(`Location: ${outputPath}`);
    console.log(`Address: ${wallet.address}`);
    console.log(`Public Key: ${wallet.publicKey}\n`);

    // Verify keystore was created
    const stats = fs.statSync(outputPath);
    console.log(`File size: ${stats.size} bytes`);
    console.log('\nIMPORTANT: Store your password securely!');
    console.log('Make sure docker/keys/ is in .gitignore');

  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Run if called directly
if (require.main === module) {
  createKeystore().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { createKeystore };
