/**
 * Notification Payload DTO
 *
 * SPEC-WEBHOOK-001: T-WEBHOOK-004 - Client notification payload
 *
 * Sent to registered client services when transaction status changes.
 * Phase 2: HTTP POST method
 * Phase 3+: Queue-based (BullMQ/SQS) - future enhancement
 */
export class NotificationPayloadDto {
  /**
   * Event type identifier
   */
  event: "transaction.status.updated";

  /**
   * Transaction ID that was updated
   */
  transactionId: string;

  /**
   * New status after update
   */
  status: string;

  /**
   * Transaction hash (if available)
   */
  hash?: string | null;

  /**
   * ISO 8601 timestamp of the notification
   */
  timestamp: string;
}

/**
 * Notification Result DTO
 *
 * Internal result of notification attempt
 */
export class NotificationResultDto {
  success: boolean;
  transactionId: string;
  statusCode?: number;
  error?: string;
}
