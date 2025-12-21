import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { isAddress } from "ethers";
import { GaslessService } from "./gasless.service";
import { GaslessTxRequestDto } from "../dto/gasless-tx-request.dto";
import { GaslessTxResponseDto } from "../dto/gasless-tx-response.dto";

/**
 * GaslessController - REST API endpoints for Gasless Transaction API
 *
 * SPEC-GASLESS-001: Gasless Transaction API
 * - U-GASLESS-001: EIP-712 Signature Verification
 * - U-GASLESS-003: Nonce Query API
 * - U-GASLESS-005: Response Format
 * - U-GASLESS-006: Error Handling
 */
@ApiTags("Gasless Transaction")
@Controller("api/v1/relay/gasless")
export class GaslessController {
  constructor(private readonly gaslessService: GaslessService) {}

  /**
   * Submit a gasless transaction via ERC2771Forwarder
   *
   * Process:
   * 1. Receive POST request with GaslessTxRequestDto
   * 2. NestJS automatically validates DTO (class-validator)
   * 3. Call gaslessService.sendGaslessTransaction()
   * 4. Return 202 Accepted with GaslessTxResponseDto
   *
   * HTTP Status:
   * - 202 Accepted: Transaction accepted for processing
   * - 400 Bad Request: Invalid request data or validation failed
   * - 401 Unauthorized: Invalid signature
   * - 503 Service Unavailable: OZ Relayer or RPC unavailable
   *
   * @param dto - Validated GaslessTxRequestDto with request and signature
   * @returns GaslessTxResponseDto with transaction details
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: "Submit gasless transaction via ERC2771Forwarder",
    description:
      "Submit a gasless meta-transaction signed with EIP-712 to be executed via ERC2771Forwarder",
  })
  @ApiResponse({
    status: 202,
    type: GaslessTxResponseDto,
    description: "Transaction accepted for processing",
  })
  @ApiResponse({
    status: 400,
    description:
      "Bad Request: Invalid request data, expired deadline, or nonce mismatch",
  })
  @ApiResponse({
    status: 401,
    description: "Unauthorized: Invalid EIP-712 signature",
  })
  @ApiResponse({
    status: 503,
    description: "Service Unavailable: OZ Relayer or RPC endpoint unavailable",
  })
  async submitGaslessTransaction(
    @Body() dto: GaslessTxRequestDto,
  ): Promise<GaslessTxResponseDto> {
    return this.gaslessService.sendGaslessTransaction(dto);
  }

  /**
   * Query nonce value for an address from ERC2771Forwarder
   *
   * Returns the current nonce that must be used for the next gasless transaction
   * Client must call this endpoint before signing the EIP-712 message
   *
   * Process:
   * 1. Validate address is valid Ethereum address
   * 2. Query nonce from Forwarder contract via JSON-RPC
   * 3. Return nonce value
   *
   * HTTP Status:
   * - 200 OK: Nonce query successful
   * - 400 Bad Request: Invalid Ethereum address
   * - 503 Service Unavailable: RPC endpoint unavailable
   *
   * @param address - Ethereum address to query nonce for
   * @returns Object with nonce value as string
   */
  @Get("nonce/:address")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Query nonce from ERC2771Forwarder",
    description:
      "Get the current nonce for an address. Client must use this nonce when signing EIP-712 message.",
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: "object",
      properties: {
        nonce: {
          type: "string",
          example: "0",
          description: "Current nonce value for the address",
        },
      },
    },
    description: "Current nonce value",
  })
  @ApiResponse({
    status: 400,
    description: "Bad Request: Invalid Ethereum address format",
  })
  @ApiResponse({
    status: 503,
    description: "Service Unavailable: RPC endpoint unavailable",
  })
  async getNonce(
    @Param("address") address: string,
  ): Promise<{ nonce: string }> {
    // Validate address is valid Ethereum address
    if (!isAddress(address)) {
      throw new BadRequestException("Invalid Ethereum address format");
    }

    // Query nonce from Forwarder
    const nonce = await this.gaslessService.getNonceFromForwarder(address);

    return { nonce };
  }
}
