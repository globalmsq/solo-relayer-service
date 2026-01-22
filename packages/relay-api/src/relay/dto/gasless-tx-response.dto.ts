import { ApiProperty } from "@nestjs/swagger";

/**
 * Gasless Transaction Response DTO
 * Response returned after successful transaction submission to OZ Relayer
 *
 * SPEC-GASLESS-001: Gasless Transaction API
 * - U-GASLESS-005: Response Format
 */
export class GaslessTxResponseDto {
  /**
   * Unique transaction identifier assigned by OZ Relayer
   * Example: tx_abc123def456
   */
  @ApiProperty({
    description: "Unique transaction identifier",
    example: "tx_abc123def456",
  })
  transactionId: string;

  /**
   * Transaction hash on blockchain (null when pending)
   * Populated after transaction is mined on-chain
   * Example: 0xabc123def456789...
   */
  @ApiProperty({
    description: "Transaction hash on blockchain (null when pending)",
    example:
      "0xabc123def456789abc123def456789abc123def456789abc123def456789abc1",
    nullable: true,
  })
  transactionHash: string | null;

  /**
   * Current transaction status
   * Possible values: pending, confirmed, failed
   * Example: pending
   */
  @ApiProperty({
    description: "Transaction status",
    example: "pending",
  })
  status: string;

  /**
   * ISO timestamp when transaction was created
   * Format: YYYY-MM-DDTHH:mm:ss.SSSZ
   * Example: 2025-12-19T10:30:00.000Z
   */
  @ApiProperty({
    description: "Creation timestamp (ISO 8601)",
    example: "2025-12-19T10:30:00.000Z",
  })
  createdAt: string;
}
