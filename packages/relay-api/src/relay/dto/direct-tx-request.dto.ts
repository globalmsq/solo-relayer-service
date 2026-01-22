import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEthereumAddress,
  IsHexadecimal,
  IsOptional,
  IsNumberString,
  IsEnum,
  IsBoolean,
} from "class-validator";

/**
 * Direct Transaction Request DTO
 * Validates and transforms incoming direct transaction requests
 *
 * SPEC-PROXY-001: Direct Transaction API
 * - U-PROXY-007: System shall validate Direct Transaction requests using DTOs
 */
export class DirectTxRequestDto {
  /**
   * Target contract address (Ethereum address format)
   * Example: 0x1234567890123456789012345678901234567890
   */
  @ApiProperty({
    description: "Target contract address (Ethereum format)",
    example: "0x1234567890123456789012345678901234567890",
  })
  @IsEthereumAddress()
  to: string;

  /**
   * Encoded function call data (hexadecimal format)
   * Example: 0xabcdef
   */
  @ApiProperty({
    description: "Encoded function call data (hexadecimal)",
    example: "0xabcdef",
  })
  @IsHexadecimal()
  data: string;

  /**
   * ETH amount to send in wei (optional)
   * Example: 1000000000000000000 (1 ETH)
   */
  @ApiPropertyOptional({
    description: "ETH amount to send (wei)",
    example: "1000000000000000000",
  })
  @IsOptional()
  @IsNumberString()
  value?: string;

  /**
   * Gas limit for transaction (optional)
   * Example: 21000
   */
  @ApiPropertyOptional({
    description: "Gas limit",
    example: "21000",
  })
  @IsOptional()
  @IsNumberString()
  gasLimit?: string;

  /**
   * Transaction speed / priority (optional)
   * Allowed values: safeLow, average, fast, fastest
   */
  @ApiPropertyOptional({
    description: "Transaction speed (safeLow, average, fast, fastest)",
    enum: ["safeLow", "average", "fast", "fastest"],
    example: "fast",
  })
  @IsOptional()
  @IsEnum(["safeLow", "average", "fast", "fastest"])
  speed?: string;

  /**
   * SPEC-DLQ-001: DLQ retry strategy (optional)
   * Controls whether DLQ Consumer should attempt reprocessing
   * - true: Attempt reprocessing when message reaches DLQ
   * - false/undefined: Mark as failed immediately (default behavior)
   * U-3: MUST be backward compatible (field is optional)
   * UN-4: MUST NOT break compatibility with existing clients
   */
  @ApiPropertyOptional({
    description: "Enable retry when transaction reaches DLQ (default: false)",
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  retryOnFailure?: boolean;
}
