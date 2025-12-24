import axios from 'axios';

/**
 * Transaction Status Polling Utilities
 *
 * Provides exponential backoff polling for transaction status queries.
 * Optimized for Hardhat local development with faster timeouts.
 */

export interface PollingConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  terminalStatuses: string[];
}

export interface TxStatusResult {
  transactionId: string;
  hash: string | null;
  status: string;
  createdAt: string;
  confirmedAt?: string;
  from?: string;
  to?: string;
  value?: string;
}

/**
 * Default polling config for production networks
 */
export const DEFAULT_POLLING_CONFIG: PollingConfig = {
  maxAttempts: 30,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  backoffMultiplier: 1.5,
  terminalStatuses: ['confirmed', 'mined', 'failed', 'reverted'],
};

/**
 * Optimized polling config for Hardhat local network
 * OZ Relayer needs time to submit and mine transactions:
 * - Submit to blockchain: ~1 second
 * - Wait for block mining: ~2 seconds (average_blocktime_ms: 2000)
 * - Status update: ~1 second
 * Total: ~4-5 seconds minimum per transaction
 *
 * Config: 20 attempts × 500ms average = ~10 seconds total polling time
 */
export const HARDHAT_POLLING_CONFIG: PollingConfig = {
  maxAttempts: 20,
  initialDelayMs: 500,
  maxDelayMs: 2000,
  backoffMultiplier: 1.3,
  terminalStatuses: ['confirmed', 'mined', 'failed', 'reverted'],
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get relay API base URL from environment
 */
function getRelayApiUrl(): string {
  return process.env.RELAY_API_URL || 'http://localhost:3000';
}

/**
 * Get API key from environment
 */
function getApiKey(): string {
  return process.env.RELAY_API_KEY || 'local-dev-api-key';
}

/**
 * Query transaction status from Relay API
 * @param transactionId - OZ Relayer transaction ID
 */
export async function getTransactionStatus(transactionId: string): Promise<TxStatusResult> {
  const baseUrl = getRelayApiUrl();
  const apiKey = getApiKey();

  const response = await axios.get(`${baseUrl}/api/v1/relay/status/${transactionId}`, {
    headers: { 'x-api-key': apiKey },
  });

  return response.data;
}

/**
 * Poll transaction status until it reaches a terminal state
 *
 * Uses exponential backoff to avoid overwhelming the server.
 * Returns when status is one of: confirmed, mined, failed, reverted
 *
 * @param transactionId - OZ Relayer transaction ID
 * @param config - Polling configuration (default: HARDHAT_POLLING_CONFIG)
 * @throws Error if transaction does not reach terminal status within max attempts
 *
 * @example
 * ```typescript
 * const response = await submitTransaction(payload);
 * const finalStatus = await pollTransactionStatus(response.transactionId);
 * expect(finalStatus.status).toBe('confirmed');
 * ```
 */
export async function pollTransactionStatus(
  transactionId: string,
  config: PollingConfig = HARDHAT_POLLING_CONFIG,
): Promise<TxStatusResult> {
  let attempt = 0;
  let delay = config.initialDelayMs;

  while (attempt < config.maxAttempts) {
    try {
      const status = await getTransactionStatus(transactionId);

      // Check if terminal status reached
      if (config.terminalStatuses.includes(status.status)) {
        return status;
      }

      // Log progress for debugging
      if (attempt % 3 === 0) {
        console.log(`   Polling [${attempt + 1}/${config.maxAttempts}]: status=${status.status}`);
      }
    } catch (error) {
      // Log error but continue polling (transient failures)
      console.warn(`   Polling error [${attempt + 1}]: ${error instanceof Error ? error.message : error}`);
    }

    // Wait with exponential backoff
    await sleep(delay);
    delay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs);
    attempt++;
  }

  throw new Error(
    `Transaction ${transactionId} did not reach terminal status after ${config.maxAttempts} attempts`,
  );
}

/**
 * Check if a status is terminal (no further changes expected)
 */
export function isTerminalStatus(status: string): boolean {
  return DEFAULT_POLLING_CONFIG.terminalStatuses.includes(status);
}

/**
 * Check if a status indicates success
 */
export function isSuccessStatus(status: string): boolean {
  return ['confirmed', 'mined'].includes(status);
}

/**
 * Check if a status indicates failure
 */
export function isFailureStatus(status: string): boolean {
  return ['failed', 'reverted'].includes(status);
}
