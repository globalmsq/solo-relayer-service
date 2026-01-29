import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment from .env file (optional - env vars may already be set via CI/Docker/shell)
const envFile = process.env.ENV_FILE || '.env';
const envPath = path.resolve(__dirname, '..', envFile);
dotenv.config({ path: envPath });

// Validate required environment variables
const requiredEnvVars = ['RPC_URL', 'CHAIN_ID', 'FORWARDER_ADDRESS', 'RELAY_API_KEY', 'RELAY_API_URL'];
const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);

if (missingEnvVars.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingEnvVars.join(', ')}\n` +
      `Please set them via environment or create a .env file:\n` +
      `  cp .env.example .env`,
  );
}
