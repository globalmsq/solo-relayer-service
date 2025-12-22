import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { verifyTypedData, TypedDataDomain, TypedDataField } from "ethers";
import { ForwardRequestDto } from "../dto/forward-request.dto";

/**
 * SignatureVerifierService - EIP-712 Signature Verification
 *
 * SPEC-GASLESS-001: Gasless Transaction API
 * - U-GASLESS-001: EIP-712 Signature Verification
 * - U-GASLESS-002: Deadline Validation
 * - T-GASLESS-001: ethers.js v6 Integration
 * - T-GASLESS-002: EIP-712 Domain and Type Structure
 */
@Injectable()
export class SignatureVerifierService {
  private readonly logger = new Logger(SignatureVerifierService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Build EIP-712 Domain structure
   * Used for signature verification with ethers.js verifyTypedData()
   *
   * Domain parameters:
   * - name: from FORWARDER_NAME env var (default: 'MSQForwarder')
   *         MUST match the name used during ERC2771Forwarder deployment
   * - version: '1' (contract version)
   * - chainId: from configuration (network chain ID)
   * - verifyingContract: from configuration (Forwarder contract address)
   */
  private buildEIP712Domain(): TypedDataDomain {
    return {
      name: this.configService.get<string>("FORWARDER_NAME") || "MSQForwarder",
      version: "1",
      chainId: this.configService.get<number>("CHAIN_ID") || 31337,
      verifyingContract: this.configService.get<string>("FORWARDER_ADDRESS"),
    };
  }

  /**
   * Build EIP-712 Type structure for ForwardRequest
   * Matches ERC2771Forwarder contract structure (7 fields)
   *
   * TypeHash order matters for signature verification:
   * ForwardRequest must include nonce field for proper signature validation
   */
  private buildEIP712Types(): Record<string, Array<TypedDataField>> {
    return {
      ForwardRequest: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "gas", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint48" },
        { name: "data", type: "bytes" },
      ],
    };
  }

  /**
   * Verify EIP-712 signature against ForwardRequest
   *
   * Process:
   * 1. Build EIP-712 domain and types
   * 2. Extract signer from signature using verifyTypedData()
   * 3. Compare recovered signer with request.from
   * 4. Return true if signatures match, false otherwise
   *
   * @param request - ForwardRequest DTO with all transaction details
   * @param signature - EIP-712 signature to verify
   * @returns true if signature is valid and signer matches request.from, false otherwise
   */
  verifySignature(request: ForwardRequestDto, signature: string): boolean {
    try {
      const domain = this.buildEIP712Domain();
      const types = this.buildEIP712Types();

      // Build message object with all request fields including nonce
      const message = {
        from: request.from,
        to: request.to,
        value: request.value,
        gas: request.gas,
        nonce: request.nonce,
        deadline: request.deadline,
        data: request.data,
      };

      // Recover signer address from signature using ethers.js
      const recoveredAddress = verifyTypedData(
        domain,
        types,
        message,
        signature,
      );

      // Compare recovered signer with request.from (case-insensitive)
      const isValid =
        recoveredAddress.toLowerCase() === request.from.toLowerCase();

      if (!isValid) {
        this.logger.warn(
          `Signature verification failed: recovered ${recoveredAddress}, expected ${request.from}`,
        );
      }

      return isValid;
    } catch (error) {
      // Log signature verification failure for security monitoring
      this.logger.warn(
        `Signature verification error for address ${request.from}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return false;
    }
  }

  /**
   * Validate deadline is in the future
   *
   * Uses server time (Date.now() / 1000) for comparison
   * Note: Final on-chain validation uses block.timestamp in ERC2771Forwarder contract
   *
   * @param deadline - Unix timestamp (uint48) when transaction expires
   * @returns true if deadline is in the future (or equal to current time), false if expired
   */
  validateDeadline(deadline: number): boolean {
    // Get current server time in seconds
    const currentTime = Math.floor(Date.now() / 1000);

    // Accept if deadline >= current time (allows exact match for current timestamp)
    return currentTime <= deadline;
  }
}
