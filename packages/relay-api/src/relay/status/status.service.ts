import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import { OzRelayerService } from "../../oz-relayer/oz-relayer.service";
import { TxStatusResponseDto } from "./dto/tx-status-response.dto";

/**
 * StatusService - Transaction Status Query
 *
 * SPEC-STATUS-001: Transaction Status Polling API - Phase 1
 * Direct HTTP calls for proper 404/503 error differentiation
 *
 * Design Decision: Uses direct HttpService instead of OzRelayerService.getTransactionStatus()
 * because OzRelayerService converts all errors to ServiceUnavailableException, losing the
 * ability to distinguish 404 (not found) from 503 (service unavailable).
 */
@Injectable()
export class StatusService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly ozRelayerService: OzRelayerService,
  ) {}

  /**
   * Query transaction status from OZ Relayer
   *
   * @param txId - Transaction ID (UUID v4 format)
   * @returns TxStatusResponseDto with status, hash, and execution details
   * @throws NotFoundException if transaction not found (HTTP 404)
   * @throws ServiceUnavailableException if OZ Relayer unavailable (HTTP 5xx, timeout, etc.)
   */
  async getTransactionStatus(txId: string): Promise<TxStatusResponseDto> {
    try {
      // Get relayer ID
      const relayerId = await this.ozRelayerService.getRelayerId();
      const relayerUrl = this.configService.get<string>(
        "OZ_RELAYER_URL",
        "http://oz-relayer-lb:8080",
      );
      const apiKey = this.configService.get<string>(
        "OZ_RELAYER_API_KEY",
        "oz-relayer-shared-api-key-local-dev",
      );

      // Direct HTTP call to OZ Relayer for proper error handling
      const response = await firstValueFrom(
        this.httpService.get(
          `${relayerUrl}/api/v1/relayers/${relayerId}/transactions/${txId}`,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
            timeout: 10000, // 10 seconds timeout
          },
        ),
      );

      // Transform OZ Relayer response to standardized DTO
      // Handle both nested (data.data) and flat response structures
      const data = response.data.data || response.data;

      return {
        transactionId: data.id || txId,
        hash: data.hash || null,
        status: data.status || "unknown",
        createdAt: data.created_at || new Date().toISOString(),
        confirmedAt: data.confirmed_at,
        from: data.from,
        to: data.to,
        value: data.value,
      };
    } catch (error) {
      // 404: Transaction not found
      if (error.response?.status === 404) {
        throw new NotFoundException("Transaction not found");
      }

      // All other errors: Service unavailable
      // Includes: 5xx errors, timeouts, connection refused, etc.
      throw new ServiceUnavailableException("OZ Relayer service unavailable");
    }
  }
}
