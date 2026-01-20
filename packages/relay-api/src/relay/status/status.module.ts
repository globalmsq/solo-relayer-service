import { Module } from "@nestjs/common";
import { StatusController } from "./status.controller";
import { StatusService } from "./status.service";

/**
 * StatusModule - Transaction Status Query Module
 *
 * SPEC-STATUS-001: Transaction Status Polling API - Phase 1
 * SPEC-DISCOVERY-001: OZ Relayer removed - uses 2-tier lookup (Redis + MySQL)
 *
 * Registers StatusController and StatusService for transaction status queries.
 * Status data is stored by queue-consumer after OZ Relayer processing.
 */
@Module({
  imports: [],
  controllers: [StatusController],
  providers: [StatusService],
  exports: [StatusService],
})
export class StatusModule {}
