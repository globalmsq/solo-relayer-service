-- SPEC-DLQ-001: Add retry_on_failure field for DLQ retry strategy
-- Controls whether DLQ Consumer should attempt reprocessing
-- true: Attempt reprocessing when message reaches DLQ
-- false/null: Mark as failed immediately (default behavior)
-- U-3: MUST be compatible with existing transactions (default: false)

ALTER TABLE `transactions` ADD COLUMN `retry_on_failure` BOOLEAN NULL DEFAULT false;
