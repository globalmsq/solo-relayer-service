import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment from .env file
const envFile = process.env.ENV_FILE || '.env';
const envPath = path.resolve(__dirname, '..', envFile);

const result = dotenv.config({ path: envPath });
if (result.error) {
  throw new Error(
    `Failed to load ${envFile} file.\n` +
      `Please copy .env.example to .env:\n` +
      `  cp .env.example .env`,
  );
}

// Validate required environment variables
const requiredEnvVars = ['RPC_URL', 'CHAIN_ID', 'FORWARDER_ADDRESS', 'RELAY_API_KEY', 'RELAY_API_URL'];
const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);

if (missingEnvVars.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingEnvVars.join(', ')}\n` +
      `Please check your .env file.`,
  );
}
