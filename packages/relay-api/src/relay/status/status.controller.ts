import {
  Controller,
  Get,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from "@nestjs/swagger";
import { StatusService } from "./status.service";
import { TxStatusResponseDto } from "./dto/tx-status-response.dto";

/**
 * StatusController - Transaction Status Query Endpoint
 *
 * SPEC-STATUS-001: Transaction Status Polling API - Phase 1
 * Provides GET endpoint for querying transaction status by ID
 */
@ApiTags("Transaction Status")
@Controller("relay/status")
export class StatusController {
  constructor(private readonly statusService: StatusService) {}

  /**
   * Query transaction status by ID
   *
   * @param txId - Transaction ID in UUID v4 format
   * @returns TxStatusResponseDto with transaction details
   * @throws BadRequestException if UUID format invalid
   * @throws NotFoundException if transaction not found
   * @throws ServiceUnavailableException if OZ Relayer unavailable
   */
  @Get(":txId")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Query transaction status by ID",
    description:
      "Get the current status of a transaction submitted via /direct or /gasless",
  })
  @ApiParam({
    name: "txId",
    description: "Transaction ID in UUID v4 format",
    example: "123e4567-e89b-12d3-a456-426614174000",
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: "Transaction status retrieved successfully",
    type: TxStatusResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Invalid transaction ID format (not a valid UUID v4)",
    schema: {
      example: {
        statusCode: 400,
        message: "Invalid transaction ID format",
        error: "Bad Request",
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: "Transaction not found in OZ Relayer",
    schema: {
      example: {
        statusCode: 404,
        message: "Transaction not found",
        error: "Not Found",
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: "OZ Relayer service unavailable or timeout",
    schema: {
      example: {
        statusCode: 503,
        message: "OZ Relayer service unavailable",
        error: "Service Unavailable",
      },
    },
  })
  async getTransactionStatus(
    @Param("txId") txId: string,
  ): Promise<TxStatusResponseDto> {
    // Validate UUID format (loose validation - standard UUID format)
    // Format: 8-4-4-4-12 hexadecimal digits (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(txId)) {
      throw new BadRequestException("Invalid transaction ID format");
    }

    // Query transaction status from service
    return this.statusService.getTransactionStatus(txId);
  }
}
