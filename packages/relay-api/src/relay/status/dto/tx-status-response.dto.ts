import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * TxStatusResponseDto - Transaction Status Response
 *
 * SPEC-STATUS-001: Transaction Status Polling API - Phase 1
 * Response format for transaction status queries to OZ Relayer
 */
export class TxStatusResponseDto {
  @ApiProperty({
    description: "Transaction ID (UUID v4 format)",
    example: "123e4567-e89b-12d3-a456-426614174000",
  })
  transactionId: string;

  @ApiProperty({
    description: "Transaction hash from blockchain (null if pending)",
    example:
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    nullable: true,
  })
  transactionHash: string | null;

  @ApiProperty({
    description: "Transaction status",
    enum: [
      "pending",
      "sent",
      "submitted",
      "inmempool",
      "mined",
      "confirmed",
      "failed",
    ],
    example: "confirmed",
  })
  status: string;

  @ApiProperty({
    description: "Transaction creation timestamp (ISO 8601)",
    example: "2025-12-22T10:00:00.000Z",
  })
  createdAt: string;

  @ApiPropertyOptional({
    description: "Transaction confirmation timestamp (ISO 8601)",
    example: "2025-12-22T10:05:00.000Z",
  })
  confirmedAt?: string;

  @ApiPropertyOptional({
    description: "Sender address (Ethereum address)",
    example: "0xUser123...",
  })
  from?: string;

  @ApiPropertyOptional({
    description:
      "Recipient address (Ethereum address or Forwarder for gasless)",
    example: "0xContract456...",
  })
  to?: string;

  @ApiPropertyOptional({
    description: "Transaction value in wei (string for large numbers)",
    example: "1000000000000000000",
  })
  value?: string;
}
