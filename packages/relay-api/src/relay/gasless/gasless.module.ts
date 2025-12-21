import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { GaslessController } from "./gasless.controller";
import { GaslessService } from "./gasless.service";
import { SignatureVerifierService } from "./signature-verifier.service";
import { OzRelayerModule } from "../../oz-relayer/oz-relayer.module";

/**
 * GaslessModule - Gasless Transaction API module
 *
 * SPEC-GASLESS-001: Gasless Transaction API
 * Provides gasless meta-transaction functionality via ERC2771Forwarder
 *
 * Module exports:
 * - GaslessController: REST endpoints
 * - GaslessService: Transaction orchestration
 * - SignatureVerifierService: EIP-712 signature verification
 *
 * Dependencies:
 * - HttpModule: For JSON-RPC calls to Forwarder contract
 * - OzRelayerModule: For transaction submission
 */
@Module({
  imports: [HttpModule, OzRelayerModule],
  controllers: [GaslessController],
  providers: [GaslessService, SignatureVerifierService],
  exports: [GaslessService, SignatureVerifierService],
})
export class GaslessModule {}
