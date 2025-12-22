import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { StatusController } from "./status.controller";
import { StatusService } from "./status.service";
import { OzRelayerModule } from "../../oz-relayer/oz-relayer.module";

/**
 * StatusModule - Transaction Status Query Module
 *
 * SPEC-STATUS-001: Transaction Status Polling API - Phase 1
 * Registers StatusController and StatusService for transaction status queries
 */
@Module({
  imports: [
    HttpModule, // Direct HTTP calls to OZ Relayer
    OzRelayerModule, // getRelayerId() method access
  ],
  controllers: [StatusController],
  providers: [StatusService],
  exports: [StatusService],
})
export class StatusModule {}
