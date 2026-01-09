-- SPEC-ROUTING-001 DC-005: Add OZ Relayer URL for tracking
-- Stores the URL of the OZ Relayer that processed this TX for debugging/audit

ALTER TABLE `transactions` ADD COLUMN `oz_relayer_url` VARCHAR(191) NULL;
