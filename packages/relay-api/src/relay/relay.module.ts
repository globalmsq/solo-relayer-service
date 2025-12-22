import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { OzRelayerModule } from "../oz-relayer/oz-relayer.module";
import { DirectController } from "./direct/direct.controller";
import { DirectService } from "./direct/direct.service";
import { GaslessModule } from "./gasless/gasless.module";
import { StatusModule } from "./status/status.module";

/**
 * RelayModule - NestJS module for relay/relayer functionality
 *
 * SPEC-PROXY-001: Direct Transaction API
 * SPEC-GASLESS-001: Gasless Transaction API
 * SPEC-STATUS-001: Transaction Status Polling API
 *
 * Registers:
 * - DirectController: POST /relay/direct endpoint
 * - DirectService: Business logic for direct transactions
 * - GaslessModule: Gasless transaction API endpoints
 * - StatusModule: Transaction status query API endpoints
 * - OzRelayerModule: Access to OZ Relayer service
 * - HttpModule: HTTP client for relayer communication
 */
@Module({
  imports: [HttpModule, OzRelayerModule, GaslessModule, StatusModule],
  controllers: [DirectController],
  providers: [DirectService],
})
export class RelayModule {}
