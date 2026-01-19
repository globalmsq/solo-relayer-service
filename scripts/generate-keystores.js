/**
 * Batch Keystore Generation Script for OZ Relayers
 *
 * Generates keystores for relayer-1 and relayer-2 using Hardhat test accounts
 * SPEC-DISCOVERY-001: Zero-based naming (relayer-0, relayer-1, relayer-2)
 * Usage: node scripts/generate-keystores.js
 */

const { Wallet } = require('ethers');
const fs = require('fs');
const path = require('path');

// Hardhat test accounts (standard well-known test keys)
// These are publicly known test keys - NEVER use in production!
// Reference: https://hardhat.org/hardhat-network/docs/reference#initial-state
const HARDHAT_ACCOUNTS = {
  // Account #10 - Used by relayer-0
  10: {
    address: '0xBcd4042DE499D14e55001CcbB24a551F3b954096',
    privateKey: '0xf214f2b2cd398c806f84e317254e0f0b801d0643303237d97a22a48e01628897'
  },
  // Account #11 - Used by relayer-1
  11: {
    address: '0x71bE63f3384f5fb98995898A86B02Fb2426c5788',
    privateKey: '0x701b615bbdfb9de65240bc28bd21bbc0d996645a3dd57e7b12bc2bdf6f192c82'
  },
  // Account #12 - Used by relayer-2
  12: {
    address: '0xFABB0ac9d68B0B445fB7357272Ff202C5651694a',
    privateKey: '0xa267530f49f8280200edf313ee7af6b827f2a8bce2897751d06a843f644967b1'
  }
};

// Test password (matches relayer config)
const PASSWORD = 'hardhat-test-passphrase';

/**
 * Generate keystore for a specific relayer
 */
async function generateKeystore(relayerNum, accountNum) {
  const account = HARDHAT_ACCOUNTS[accountNum];
  const outputPath = path.join(__dirname, '..', 'docker', 'keys', `relayer-${relayerNum}`, 'keystore.json');

  console.log(`\n[Relayer ${relayerNum}] Generating keystore...`);
  console.log(`  Account: #${accountNum}`);
  console.log(`  Address: ${account.address}`);

  // Create wallet and encrypt
  const wallet = new Wallet(account.privateKey);
  let keystore = await wallet.encrypt(PASSWORD);

  // Fix: ethers.js uses "Crypto" but OZ Relayer expects "crypto" (lowercase)
  const keystoreObj = JSON.parse(keystore);
  if (keystoreObj.Crypto && !keystoreObj.crypto) {
    keystoreObj.crypto = keystoreObj.Crypto;
    delete keystoreObj.Crypto;
    keystore = JSON.stringify(keystoreObj, null, 2);
  }

  // Create directory if it doesn't exist
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`  Created directory: ${dir}`);
  }

  // Write keystore file
  fs.writeFileSync(outputPath, keystore);
  console.log(`  Output: ${outputPath}`);

  // Verify
  const stats = fs.statSync(outputPath);
  console.log(`  File size: ${stats.size} bytes`);
  console.log(`  ✅ Keystore generated successfully!`);

  return { relayerNum, address: wallet.address };
}

/**
 * Main function
 */
async function main() {
  console.log('========================================');
  console.log('OZ Relayer Batch Keystore Generation');
  console.log('========================================');
  console.log('\nWARNING: These use Hardhat test keys.');
  console.log('NEVER use these keystores in production!\n');

  const results = [];

  // Generate keystores for all relayers (relayer-0, relayer-1, relayer-2)
  // SPEC-DISCOVERY-001: Zero-based naming convention
  results.push(await generateKeystore(0, 10));  // relayer-0 uses Account #10
  results.push(await generateKeystore(1, 11));  // relayer-1 uses Account #11
  results.push(await generateKeystore(2, 12));  // relayer-2 uses Account #12

  console.log('\n========================================');
  console.log('Summary');
  console.log('========================================');
  for (const r of results) {
    console.log(`  Relayer ${r.relayerNum}: ${r.address}`);
  }
  console.log('\nPassword for all keystores: hardhat-test-passphrase');
  console.log('\nNext: docker compose up --build');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
