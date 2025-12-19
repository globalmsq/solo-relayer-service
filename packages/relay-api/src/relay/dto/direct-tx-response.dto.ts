import { ApiProperty } from "@nestjs/swagger";

/**
 * Direct Transaction Response DTO
 * Response returned after successful direct transaction submission
 *
 * SPEC-PROXY-001: Direct Transaction API
 * - U-PROXY-008: System shall return HTTP 202 Accepted for successful Direct Transaction submissions
 */
export class DirectTxResponseDto {
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
   * Example: 0xabc123def456789...
   */
  @ApiProperty({
    description: "Transaction hash on blockchain (null when pending)",
    example:
      "0xabc123def456789abc123def456789abc123def456789abc123def456789abc1",
    nullable: true,
  })
  hash: string | null;

  /**
   * Current transaction status
   * Example: pending, confirmed, failed
   */
  @ApiProperty({
    description: "Transaction status",
    example: "pending",
  })
  status: string;

  /**
   * ISO timestamp when transaction was created
   * Example: 2025-12-19T10:30:00.000Z
   */
  @ApiProperty({
    description: "Creation timestamp (ISO 8601)",
    example: "2025-12-19T10:30:00.000Z",
  })
  createdAt: string;
}
