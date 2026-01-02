-- CreateTable
CREATE TABLE `transactions` (
    `id` VARCHAR(191) NOT NULL,
    `hash` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `from` VARCHAR(191) NULL,
    `to` VARCHAR(191) NULL,
    `value` VARCHAR(191) NULL,
    `data` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `confirmedAt` DATETIME(3) NULL,

    UNIQUE INDEX `transactions_hash_key`(`hash`),
    INDEX `transactions_status_idx`(`status`),
    INDEX `transactions_hash_idx`(`hash`),
    INDEX `transactions_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
