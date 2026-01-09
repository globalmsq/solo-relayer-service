import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";

/**
 * Direct Transaction Request Interface
 * Represents a blockchain transaction to be relayed
 */
export interface DirectTxRequest {
  to: string;
  data: string;
  value?: string;
  gasLimit?: string;
  speed?: string;
}

/**
 * Direct Transaction Response Interface
 * Response from OZ Relayer after transaction submission
 */
export interface DirectTxResponse {
  transactionId: string;
  hash: string | null;
  status: string;
  createdAt: string;
}

/**
 * OZ Relayer API Response wrapper
 */
interface OzRelayerApiResponse<T> {
  success: boolean;
  data: T;
  error: string | null;
}

/**
 * OZ Relayer Transaction Data
 */
interface OzRelayerTxData {
  id: string;
  hash: string | null;
  status: string;
  created_at: string;
  from: string;
  to: string;
}

/**
 * OzRelayerService - Single OZ Relayer Instance (Phase 1 MVP)
 *
 * SPEC-GASLESS-001: Gasless Transaction API
 * - Single relayer instance for simplified Phase 1 deployment
 * - Relayer ID caching for performance optimization
 * - Phase 2+: Queue system (BullMQ/SQS) with multiple instances
 */
@Injectable()
export class OzRelayerService {
  private readonly relayerUrl: string;
  private readonly relayerApiKey: string;
  private relayerId: string | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    // Single Nginx LB endpoint (or external LB in production)
    this.relayerUrl = this.configService.get<string>(
      "OZ_RELAYER_URL",
      "http://oz-relayer-lb:8080",
    );
    // OZ Relayer API Key for authentication (Bearer token)
    this.relayerApiKey = this.configService.get<string>(
      "OZ_RELAYER_API_KEY",
      "oz-relayer-shared-api-key-local-dev",
    );
  }

  /**
   * Fetch the relayer ID from OZ Relayer with caching
   * Single instance mode: Cache relayer ID after first discovery
   * Phase 2+: Queue system will handle multi-instance routing
   *
   * SPEC-STATUS-001: Made public for StatusService access
   */
  public async getRelayerId(): Promise<string> {
    // Return cached ID if available
    if (this.relayerId) {
      return this.relayerId;
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<{ data: Array<{ id: string }> }>(
          `${this.relayerUrl}/api/v1/relayers`,
          {
            headers: {
              Authorization: `Bearer ${this.relayerApiKey}`,
            },
            timeout: 10000,
          },
        ),
      );

      if (response.data?.data?.[0]?.id) {
        this.relayerId = response.data.data[0].id;
        return this.relayerId;
      }

      throw new Error("No relayer found");
    } catch (error) {
      throw new ServiceUnavailableException("Failed to discover OZ Relayer ID");
    }
  }

  /**
   * SPEC-ROUTING-001: Fetch relayer ID from a specific relayer URL
   *
   * Unlike getRelayerId() which uses the default relayer URL,
   * this method fetches the relayer ID from any specified URL.
   * Used by StatusService to get the correct relayer ID for multi-relayer setups.
   *
   * @param relayerUrl - The specific relayer URL to query
   * @returns The relayer ID for the specified URL
   * @throws ServiceUnavailableException if relayer is unavailable
   */
  public async getRelayerIdFromUrl(relayerUrl: string): Promise<string> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<{ data: Array<{ id: string }> }>(
          `${relayerUrl}/api/v1/relayers`,
          {
            headers: {
              Authorization: `Bearer ${this.relayerApiKey}`,
            },
            timeout: 10000,
          },
        ),
      );

      if (response.data?.data?.[0]?.id) {
        return response.data.data[0].id;
      }

      throw new Error("No relayer found");
    } catch (error) {
      throw new ServiceUnavailableException(
        `Failed to discover relayer ID from ${relayerUrl}`,
      );
    }
  }

  /**
   * Send transaction to OZ Relayer
   *
   * @param request - DirectTxRequest with transaction details
   * @returns DirectTxResponse with transaction ID, hash, and status
   * @throws ServiceUnavailableException if OZ Relayer is unavailable
   */
  async sendTransaction(request: DirectTxRequest): Promise<DirectTxResponse> {
    try {
      const relayerId = await this.getRelayerId();
      const response = await firstValueFrom(
        this.httpService.post<OzRelayerApiResponse<OzRelayerTxData>>(
          `${this.relayerUrl}/api/v1/relayers/${relayerId}/transactions`,
          {
            to: request.to,
            data: request.data,
            value: request.value ? parseInt(request.value, 10) : 0,
            gas_limit: request.gasLimit
              ? parseInt(request.gasLimit, 10)
              : 21000,
            speed: request.speed || "average",
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.relayerApiKey}`,
            },
            timeout: 30000, // 30 seconds
          },
        ),
      );

      // Transform OZ Relayer response to DirectTxResponse
      const txData = response.data.data;
      return {
        transactionId: txData.id,
        hash: txData.hash,
        status: txData.status,
        createdAt: txData.created_at,
      };
    } catch (error) {
      throw new ServiceUnavailableException("OZ Relayer service unavailable");
    }
  }

  /**
   * Query transaction status from OZ Relayer
   *
   * @param txId - Transaction ID to query
   * @returns Transaction status and details
   * @throws ServiceUnavailableException if OZ Relayer is unavailable
   */
  async getTransactionStatus(txId: string): Promise<OzRelayerTxData> {
    try {
      const relayerId = await this.getRelayerId();
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.relayerUrl}/api/v1/relayers/${relayerId}/transactions/${txId}`,
          {
            headers: {
              Authorization: `Bearer ${this.relayerApiKey}`,
            },
            timeout: 10000,
          },
        ),
      );
      return response.data;
    } catch (error) {
      throw new ServiceUnavailableException("OZ Relayer service unavailable");
    }
  }
}
