import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { Interface } from "ethers";
import { SignatureVerifierService } from "./signature-verifier.service";
import { OzRelayerService } from "../../oz-relayer/oz-relayer.service";
import { GaslessTxRequestDto } from "../dto/gasless-tx-request.dto";
import { GaslessTxResponseDto } from "../dto/gasless-tx-response.dto";
import { DirectTxRequestDto } from "../dto/direct-tx-request.dto";

/**
 * GaslessService - Gasless Transaction Orchestration
 *
 * SPEC-GASLESS-001: Gasless Transaction API
 * - U-GASLESS-001: EIP-712 Signature Verification
 * - U-GASLESS-002: Deadline Validation
 * - U-GASLESS-003: Nonce Query API
 * - U-GASLESS-004: Forwarder Transaction Build
 * - U-GASLESS-005: Response Format
 * - T-GASLESS-005: Nonce Types and Management
 * - T-GASLESS-006: RPC Integration
 */
@Injectable()
export class GaslessService {
  // ERC2771Forwarder contract ABI for nonces() and execute()
  private forwarderInterface = new Interface([
    "function nonces(address from) view returns (uint256)",
    "function execute((address,address,uint256,uint256,uint256,uint48,bytes) request, bytes signature) returns (bool, bytes)",
  ]);

  constructor(
    private readonly signatureVerifier: SignatureVerifierService,
    private readonly ozRelayerService: OzRelayerService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  /**
   * Send gasless transaction via ERC2771Forwarder
   *
   * Complete workflow:
   * 1. Validate deadline is in the future
   * 2. Query expected nonce from Forwarder contract
   * 3. Validate request.nonce matches expected nonce (pre-check)
   * 4. Verify EIP-712 signature
   * 5. Build Forwarder.execute() transaction
   * 6. Submit to OZ Relayer
   * 7. Return transaction response
   *
   * @param dto - Validated GaslessTxRequestDto
   * @returns GaslessTxResponseDto with transaction details
   * @throws BadRequestException if deadline expired or nonce mismatch
   * @throws UnauthorizedException if signature invalid
   * @throws ServiceUnavailableException if RPC or OZ Relayer unavailable
   */
  async sendGaslessTransaction(
    dto: GaslessTxRequestDto,
  ): Promise<GaslessTxResponseDto> {
    // Step 1: Validate deadline is in the future
    if (!this.signatureVerifier.validateDeadline(dto.request.deadline)) {
      throw new BadRequestException("Transaction deadline expired");
    }

    // Step 2: Query expected nonce from Forwarder contract
    const expectedNonce = await this.getNonceFromForwarder(dto.request.from);

    // Step 3: Validate request.nonce matches expected nonce (Layer 1: relay-api pre-check)
    this.validateNonceMatch(dto.request.nonce, expectedNonce);

    // Step 4: Verify EIP-712 signature
    const isSignatureValid = this.signatureVerifier.verifySignature(
      dto.request,
      dto.signature,
    );

    if (!isSignatureValid) {
      throw new UnauthorizedException("Invalid EIP-712 signature");
    }

    // Step 5: Build Forwarder.execute() transaction
    const forwarderTx = this.buildForwarderExecuteTx(dto);

    // Step 6: Submit to OZ Relayer
    try {
      const response = await this.ozRelayerService.sendTransaction(forwarderTx);

      // Step 7: Return transaction response
      return {
        transactionId: response.transactionId,
        hash: response.hash,
        status: response.status,
        createdAt: response.createdAt,
      };
    } catch (error) {
      throw new ServiceUnavailableException("OZ Relayer service unavailable");
    }
  }

  /**
   * Query nonce value from ERC2771Forwarder contract
   *
   * Uses JSON-RPC eth_call to read current nonce for address
   * This is a query-only operation - relay-api does NOT manage nonces
   * The Forwarder contract automatically increments nonce after transaction executes
   *
   * @param address - Ethereum address to query nonce for
   * @returns Current nonce value as string
   * @throws ServiceUnavailableException if RPC call fails
   */
  async getNonceFromForwarder(address: string): Promise<string> {
    try {
      const rpcUrl = this.configService.get<string>("RPC_URL");
      const forwarderAddress = this.configService.get<string>(
        "FORWARDER_ADDRESS",
      );

      if (!rpcUrl || !forwarderAddress) {
        throw new Error("RPC_URL or FORWARDER_ADDRESS not configured");
      }

      // Build eth_call request to nonces(address)
      // nonces function selector: 0xc37f2c3d (first 4 bytes of keccak256("nonces(address)"))
      const noncesFunctionSelector = "0xc37f2c3d";
      const paddedAddress = address.toLowerCase().replace("0x", "").padStart(64, "0");
      const callData = noncesFunctionSelector + paddedAddress;

      // Make JSON-RPC call
      const response = await this.httpService.axiosRef.post(rpcUrl, {
        jsonrpc: "2.0",
        method: "eth_call",
        params: [
          {
            to: forwarderAddress,
            data: callData,
          },
          "latest",
        ],
        id: 1,
      });

      // Parse response (32-byte return value)
      if (response.data.result) {
        // Convert hex result to decimal string
        const nonce = BigInt(response.data.result).toString();
        return nonce;
      }

      throw new Error("No result from eth_call");
    } catch (error) {
      throw new ServiceUnavailableException(
        "Failed to query nonce from Forwarder contract",
      );
    }
  }

  /**
   * Validate that request nonce matches expected nonce
   * This is Layer 1 pre-check validation in relay-api
   *
   * Layer 1 (relay-api): Pre-check optimization - validates immediately
   * Layer 2 (Contract): Final security - ERC2771Forwarder validates on-chain
   *
   * @param requestNonce - Nonce provided in request
   * @param expectedNonce - Current nonce from Forwarder contract
   * @throws BadRequestException if nonce mismatch with detailed error message
   */
  private validateNonceMatch(requestNonce: string, expectedNonce: string): void {
    if (requestNonce !== expectedNonce) {
      throw new BadRequestException(
        `Invalid nonce: expected ${expectedNonce}, got ${requestNonce}`,
      );
    }
  }

  /**
   * Build Forwarder.execute() transaction
   *
   * Encodes the ERC2771Forwarder.execute(request, signature) call
   * The execute function takes a ForwardRequest struct and signature
   *
   * Function signature:
   * execute((address,address,uint256,uint256,uint256,uint48,bytes) request, bytes signature)
   *
   * Returns: DirectTxRequestDto to be sent to OZ Relayer
   *
   * @param dto - GaslessTxRequestDto with request and signature
   * @returns DirectTxRequestDto with encoded Forwarder call
   */
  private buildForwarderExecuteTx(dto: GaslessTxRequestDto): DirectTxRequestDto {
    const forwarderAddress = this.configService.get<string>(
      "FORWARDER_ADDRESS",
    );

    if (!forwarderAddress) {
      throw new Error("FORWARDER_ADDRESS not configured");
    }

    // Build ForwardRequest struct data in correct order for encoding
    const forwardRequestTuple = [
      dto.request.from,
      dto.request.to,
      dto.request.value,
      dto.request.gas,
      dto.request.nonce,
      dto.request.deadline,
      dto.request.data,
    ];

    // Encode execute(request, signature) call
    const callData = this.forwarderInterface.encodeFunctionData("execute", [
      forwardRequestTuple,
      dto.signature,
    ]);

    return {
      to: forwarderAddress,
      data: callData,
      value: "0", // Forwarder itself doesn't receive value
      gasLimit: undefined, // Let relayer estimate
      speed: "fast", // Default speed
    };
  }
}
