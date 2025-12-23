import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment based on ENV_FILE or default to .env
const envFile = process.env.ENV_FILE || '.env';
const envPath = path.resolve(__dirname, '..', envFile);

// Try to load the specified env file, fall back to .env.hardhat if not found
try {
  const result = dotenv.config({ path: envPath });
  if (result.error) {
    // Fall back to .env.hardhat
    dotenv.config({ path: path.resolve(__dirname, '..', '.env.hardhat') });
  }
} catch {
  dotenv.config({ path: path.resolve(__dirname, '..', '.env.hardhat') });
}

// Validate required environment variables
const requiredEnvVars = ['RPC_URL', 'CHAIN_ID', 'FORWARDER_ADDRESS', 'RELAY_API_KEY'];
const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);

if (missingEnvVars.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingEnvVars.join(', ')}\n` +
      `Please create a .env file or copy from .env.hardhat:\n` +
      `  cp .env.hardhat .env`,
  );
}

console.log('');
console.log('🔧 Integration Test Environment:');
console.log(`   ENV_FILE: ${envFile}`);
console.log(`   RPC_URL: ${process.env.RPC_URL}`);
console.log(`   CHAIN_ID: ${process.env.CHAIN_ID}`);
console.log(`   RELAY_API_KEY: ${process.env.RELAY_API_KEY ? '***' : 'NOT SET'}`);
console.log(`   FORWARDER_ADDRESS: ${process.env.FORWARDER_ADDRESS}`);
console.log('');
