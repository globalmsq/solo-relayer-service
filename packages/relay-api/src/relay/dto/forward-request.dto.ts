import { ApiProperty } from "@nestjs/swagger";
import {
  IsEthereumAddress,
  IsHexadecimal,
  IsNumberString,
} from "class-validator";

/**
 * ForwardRequest DTO - EIP-712 ForwardRequest structure
 * Represents the transaction request to be forwarded via ERC2771Forwarder
 *
 * SPEC-GASLESS-001: Gasless Transaction API
 * - T-GASLESS-002: EIP-712 Domain and Type Structure
 * - T-GASLESS-003: DTO Validation
 */
export class ForwardRequestDto {
  /**
   * Signer address (from)
   * The address that signed the EIP-712 message
   * Example: 0x1234567890123456789012345678901234567890
   */
  @ApiProperty({
    description: "Signer address (from)",
    example: "0x1234567890123456789012345678901234567890",
  })
  @IsEthereumAddress()
  from: string;

  /**
   * Target contract address (to)
   * The contract that will be called
   * Example: 0x1234567890123456789012345678901234567890
   */
  @ApiProperty({
    description: "Target contract address (to)",
    example: "0x1234567890123456789012345678901234567890",
  })
  @IsEthereumAddress()
  to: string;

  /**
   * ETH value to send in wei (uint256)
   * Example: 0 (no value sent)
   */
  @ApiProperty({
    description: "ETH value to send (wei)",
    example: "0",
  })
  @IsNumberString()
  value: string;

  /**
   * Gas limit for the forwarded call (uint256)
   * Example: 100000
   */
  @ApiProperty({
    description: "Gas limit for forwarded call",
    example: "100000",
  })
  @IsNumberString()
  gas: string;

  /**
   * Nonce from ERC2771Forwarder.nonces(from) (uint256)
   * Client must query this via GET /nonce/:address before signing
   * Example: 0
   */
  @ApiProperty({
    description: "Nonce from ERC2771Forwarder (uint256)",
    example: "0",
  })
  @IsNumberString()
  nonce: string;

  /**
   * Deadline as Unix timestamp (uint48)
   * Transaction will be rejected after this time
   * Example: "1703001000" (valid deadline in future)
   */
  @ApiProperty({
    description: "Deadline as Unix timestamp (uint48)",
    example: "1703001000",
  })
  @IsNumberString()
  deadline: string;

  /**
   * Encoded function call data (bytes)
   * The call data to be executed on the target contract
   * Example: 0xabcdef
   */
  @ApiProperty({
    description: "Encoded function call data (hex)",
    example: "0xabcdef",
  })
  @IsHexadecimal()
  data: string;
}
