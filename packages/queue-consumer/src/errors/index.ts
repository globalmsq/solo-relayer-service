/**
 * Error Classification Module
 *
 * SPEC-DLQ-001: Dead Letter Queue Processing and Error Classification
 *
 * Exports:
 * - ErrorClassifierService: Service to classify errors
 * - ErrorCategory: Enum for error categories (RETRYABLE, NON_RETRYABLE)
 * - ErrorClassificationResult: Result type for classification
 * - Error patterns and HTTP status code constants
 */
export * from "./relay-errors";
export * from "./error-classifier.service";
