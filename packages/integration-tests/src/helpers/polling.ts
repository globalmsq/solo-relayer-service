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
 * Optimized polling config for Hardhat local network
 * Balanced for Docker Compose environment:
 * - maxAttempts: 20 (allows ~12 seconds total polling time)
 * - initialDelayMs: 200ms (fast initial check)
 * - backoffMultiplier: 1.2 (gradual backoff)
 *
 * Note: SPEC-TEST-001 assumed 2-3 second confirmation, but Docker/OZ Relayer
 * chain typically takes 5-10 seconds in practice.
 */
export const HARDHAT_POLLING_CONFIG: PollingConfig = {
  maxAttempts: 20,
  initialDelayMs: 200,
  maxDelayMs: 2000,
  backoffMultiplier: 1.2,
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
 * @throws Error if RELAY_API_URL is not set
 */
function getRelayApiUrl(): string {
  const url = process.env.RELAY_API_URL;
  if (!url) {
    throw new Error('RELAY_API_URL environment variable is required');
  }
  return url;
}

/**
 * Get API key from environment
 * @throws Error if RELAY_API_KEY is not set
 */
function getApiKey(): string {
  const key = process.env.RELAY_API_KEY;
  if (!key) {
    throw new Error('RELAY_API_KEY environment variable is required');
  }
  return key;
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
    timeout: 5000, // 5 second timeout to prevent hanging
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

      // Log progress
      console.log(`Polling [${attempt + 1}/${config.maxAttempts}]: status=${status.status}`);
    } catch (error) {
      console.log(`Polling [${attempt + 1}]: waiting...`);
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
 * Check if a status indicates success
 */
export function isSuccessStatus(status: string): boolean {
  return ['confirmed', 'mined'].includes(status);
}
