import { Injectable, Logger } from "@nestjs/common";
import {
  ErrorCategory,
  ErrorClassificationResult,
  NON_RETRYABLE_ERROR_PATTERNS,
  NON_RETRYABLE_HTTP_STATUS_CODES,
  RETRYABLE_ERROR_PATTERNS,
  RETRYABLE_HTTP_STATUS_CODES,
} from "./relay-errors";

/**
 * ErrorClassifierService - Classifies errors for DLQ routing decisions
 *
 * SPEC-DLQ-001: Dead Letter Queue Processing and Error Classification
 *
 * E-1: WHEN Consumer detects an error, it MUST call ErrorClassifierService
 *      to classify the error category.
 *
 * Classification Strategy:
 * 1. Check error message against non-retryable patterns first
 * 2. Check HTTP status code if available
 * 3. Check error message against retryable patterns
 * 4. Default to RETRYABLE for unknown errors (fail-safe approach)
 */
@Injectable()
export class ErrorClassifierService {
  private readonly logger = new Logger(ErrorClassifierService.name);

  /**
   * Classify an error into RETRYABLE or NON_RETRYABLE category
   *
   * @param error - The error to classify
   * @returns Classification result with category, reason, and original message
   */
  classify(error: Error | unknown): ErrorClassificationResult {
    const errorMessage = this.extractErrorMessage(error);
    const httpStatus = this.extractHttpStatus(error);

    // Log the error being classified
    this.logger.debug(
      `Classifying error: "${errorMessage.substring(0, 100)}..."${httpStatus ? ` (HTTP ${httpStatus})` : ""}`,
    );

    // Step 1: Check non-retryable patterns first (most specific)
    const nonRetryableMatch = this.matchNonRetryablePattern(errorMessage);
    if (nonRetryableMatch) {
      this.logger.log(
        `[NON_RETRYABLE] Pattern matched: "${nonRetryableMatch}"`,
      );
      return {
        category: ErrorCategory.NON_RETRYABLE,
        reason: nonRetryableMatch,
        originalMessage: errorMessage,
        httpStatus,
      };
    }

    // Step 2: Check non-retryable HTTP status codes
    if (httpStatus && NON_RETRYABLE_HTTP_STATUS_CODES.includes(httpStatus)) {
      this.logger.log(`[NON_RETRYABLE] HTTP status code: ${httpStatus}`);
      return {
        category: ErrorCategory.NON_RETRYABLE,
        reason: `HTTP client error: ${httpStatus}`,
        originalMessage: errorMessage,
        httpStatus,
      };
    }

    // Step 3: Check retryable HTTP status codes
    if (httpStatus && RETRYABLE_HTTP_STATUS_CODES.includes(httpStatus)) {
      this.logger.log(`[RETRYABLE] HTTP status code: ${httpStatus}`);
      return {
        category: ErrorCategory.RETRYABLE,
        reason: `HTTP server error: ${httpStatus}`,
        originalMessage: errorMessage,
        httpStatus,
      };
    }

    // Step 4: Check retryable patterns
    const retryableMatch = this.matchRetryablePattern(errorMessage);
    if (retryableMatch) {
      this.logger.log(`[RETRYABLE] Pattern matched: "${retryableMatch}"`);
      return {
        category: ErrorCategory.RETRYABLE,
        reason: retryableMatch,
        originalMessage: errorMessage,
        httpStatus,
      };
    }

    // Step 5: Default to RETRYABLE for unknown errors (fail-safe)
    // O-3: Error patterns MAY be added/modified in the future (ErrorClassifierService is extensible)
    this.logger.warn(
      `[RETRYABLE] Unknown error pattern, defaulting to RETRYABLE: "${errorMessage.substring(0, 100)}"`,
    );
    return {
      category: ErrorCategory.RETRYABLE,
      reason: "Unknown error - defaulting to retryable (fail-safe)",
      originalMessage: errorMessage,
      httpStatus,
    };
  }

  /**
   * Check if error indicates a non-retryable condition
   *
   * @param error - The error to check
   * @returns true if the error should NOT be retried
   */
  isNonRetryable(error: Error | unknown): boolean {
    return this.classify(error).category === ErrorCategory.NON_RETRYABLE;
  }

  /**
   * Check if error indicates a retryable condition
   *
   * @param error - The error to check
   * @returns true if the error CAN be retried
   */
  isRetryable(error: Error | unknown): boolean {
    return this.classify(error).category === ErrorCategory.RETRYABLE;
  }

  /**
   * Extract error message from various error types
   */
  private extractErrorMessage(error: Error | unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === "string") {
      return error;
    }

    if (error && typeof error === "object") {
      // Handle Axios-style errors
      const axiosError = error as {
        message?: string;
        response?: { data?: { message?: string; error?: string } };
      };

      if (axiosError.response?.data?.message) {
        return axiosError.response.data.message;
      }

      if (axiosError.response?.data?.error) {
        return axiosError.response.data.error;
      }

      if (axiosError.message) {
        return axiosError.message;
      }
    }

    return String(error);
  }

  /**
   * Extract HTTP status code from error if available
   */
  private extractHttpStatus(error: Error | unknown): number | undefined {
    if (error && typeof error === "object") {
      const httpError = error as {
        status?: number;
        statusCode?: number;
        response?: { status?: number; statusCode?: number };
      };

      // Direct status property
      if (typeof httpError.status === "number") {
        return httpError.status;
      }

      if (typeof httpError.statusCode === "number") {
        return httpError.statusCode;
      }

      // Axios-style response.status
      if (typeof httpError.response?.status === "number") {
        return httpError.response.status;
      }

      if (typeof httpError.response?.statusCode === "number") {
        return httpError.response.statusCode;
      }
    }

    return undefined;
  }

  /**
   * Match error message against non-retryable patterns
   *
   * @returns Description of matched pattern, or undefined if no match
   */
  private matchNonRetryablePattern(errorMessage: string): string | undefined {
    for (const { pattern, description } of NON_RETRYABLE_ERROR_PATTERNS) {
      if (pattern instanceof RegExp) {
        if (pattern.test(errorMessage)) {
          return description;
        }
      } else if (errorMessage.toLowerCase().includes(pattern.toLowerCase())) {
        return description;
      }
    }
    return undefined;
  }

  /**
   * Match error message against retryable patterns
   *
   * @returns Description of matched pattern, or undefined if no match
   */
  private matchRetryablePattern(errorMessage: string): string | undefined {
    for (const { pattern, description } of RETRYABLE_ERROR_PATTERNS) {
      if (pattern instanceof RegExp) {
        if (pattern.test(errorMessage)) {
          return description;
        }
      } else if (errorMessage.toLowerCase().includes(pattern.toLowerCase())) {
        return description;
      }
    }
    return undefined;
  }
}
