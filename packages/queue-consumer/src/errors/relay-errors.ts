/**
 * Error Classification System for Solo Relayer Service
 *
 * SPEC-DLQ-001: Dead Letter Queue Processing and Error Classification
 *
 * Classifies errors into RETRYABLE and NON_RETRYABLE categories to determine
 * whether a failed transaction should be retried via SQS or immediately marked as failed.
 */

/**
 * Error categories for transaction processing
 *
 * U-1: The system MUST classify all errors into ErrorCategory (RETRYABLE, NON_RETRYABLE).
 */
export enum ErrorCategory {
  /**
   * Retryable errors that may succeed on subsequent attempts.
   * E-3: Utilize SQS automatic retry mechanism (maxReceiveCount: 3)
   */
  RETRYABLE = "RETRYABLE",

  /**
   * Non-retryable errors that will always fail regardless of retries.
   * E-2: Immediately update Transaction status to 'failed' and delete SQS message
   * UN-1: MUST NOT resend NON_RETRYABLE errors to SQS
   */
  NON_RETRYABLE = "NON_RETRYABLE",
}

/**
 * Error pattern definition for classification
 */
export interface ErrorPattern {
  /** Regex pattern or string to match against error message */
  pattern: RegExp | string;
  /** Human-readable description of this error type */
  description: string;
}

/**
 * Non-retryable error patterns
 *
 * These errors indicate permanent failures that will not succeed on retry:
 * - Insufficient funds/balance: Account lacks ETH for gas or value
 * - Gas issues: Gas limit exceeded or too low
 * - Nonce issues: Transaction with same nonce already mined
 * - Execution reverted: Smart contract rejected the transaction
 */
export const NON_RETRYABLE_ERROR_PATTERNS: ErrorPattern[] = [
  // Balance and fund errors
  {
    pattern: /insufficient funds/i,
    description: "Insufficient balance for transaction",
  },
  {
    pattern: /insufficient balance/i,
    description: "Insufficient balance for transaction",
  },

  // Gas errors
  {
    pattern: /gas required exceeds allowance/i,
    description: "Gas limit exceeded allowance",
  },
  {
    pattern: /intrinsic gas too low/i,
    description: "Insufficient gas provided",
  },
  { pattern: /out of gas/i, description: "Transaction ran out of gas" },

  // Nonce errors
  { pattern: /nonce too low/i, description: "Nonce already used" },
  { pattern: /nonce already used/i, description: "Nonce already used" },

  // Contract execution errors
  {
    pattern: /execution reverted/i,
    description: "Smart contract execution reverted",
  },
  {
    pattern: /transaction would revert/i,
    description: "Transaction simulation failed",
  },
];

/**
 * Non-retryable HTTP status codes
 *
 * Client errors that indicate invalid requests:
 * - 400: Bad Request
 * - 401: Unauthorized
 * - 403: Forbidden
 * - 422: Unprocessable Entity
 */
export const NON_RETRYABLE_HTTP_STATUS_CODES: number[] = [400, 401, 403, 422];

/**
 * Retryable error patterns
 *
 * These errors indicate temporary failures that may succeed on retry:
 * - Network issues: Timeout, connection refused
 * - Server overload: Rate limiting, temporary unavailability
 */
export const RETRYABLE_ERROR_PATTERNS: ErrorPattern[] = [
  // Network errors
  { pattern: /network timeout/i, description: "Network timeout" },
  { pattern: /connection refused/i, description: "Connection refused" },
  {
    pattern: /ECONNREFUSED/i,
    description: "Connection refused (ECONNREFUSED)",
  },
  { pattern: /ETIMEDOUT/i, description: "Connection timed out (ETIMEDOUT)" },
  { pattern: /ENOTFOUND/i, description: "DNS lookup failed (ENOTFOUND)" },
  { pattern: /socket hang up/i, description: "Socket hang up" },
];

/**
 * Retryable HTTP status codes
 *
 * Server errors that may succeed on retry:
 * - 408: Request Timeout
 * - 429: Too Many Requests (rate limiting)
 * - 500: Internal Server Error
 * - 502: Bad Gateway
 * - 503: Service Unavailable
 * - 504: Gateway Timeout
 */
export const RETRYABLE_HTTP_STATUS_CODES: number[] = [
  408, 429, 500, 502, 503, 504,
];

/**
 * Result of error classification
 */
export interface ErrorClassificationResult {
  /** The classified error category */
  category: ErrorCategory;
  /** Human-readable reason for the classification */
  reason: string;
  /** Original error message */
  originalMessage: string;
  /** HTTP status code if available */
  httpStatus?: number;
}
