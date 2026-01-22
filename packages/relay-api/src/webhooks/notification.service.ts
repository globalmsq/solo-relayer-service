import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom, timeout, catchError } from "rxjs";
import { of } from "rxjs";
import {
  NotificationPayloadDto,
  NotificationResultDto,
} from "./dto/notification.dto";

/**
 * NotificationService - Client Notification via HTTP
 *
 * SPEC-WEBHOOK-001: T-WEBHOOK-004 - Notification Service
 *
 * Phase 2: HTTP POST method for client notifications
 * Phase 3+: Queue-based (BullMQ/SQS) - future enhancement
 *
 * Sends transaction status updates to registered client services.
 * Non-blocking: failures are logged but don't affect webhook processing.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly NOTIFICATION_TIMEOUT_MS = 5000; // 5 second timeout

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Send notification to client service
   *
   * Non-blocking operation - failures are logged but don't throw.
   * Phase 2 implementation uses simple HTTP POST.
   *
   * @param transactionId - Transaction ID that was updated
   * @param status - New transaction status
   * @param hash - Transaction hash (optional)
   * @returns NotificationResultDto with success/failure status
   */
  async notify(
    transactionId: string,
    status: string,
    hash?: string | null,
  ): Promise<NotificationResultDto> {
    const clientWebhookUrl =
      this.configService.get<string>("CLIENT_WEBHOOK_URL");

    if (!clientWebhookUrl) {
      this.logger.debug(
        "CLIENT_WEBHOOK_URL not configured, skipping notification",
      );
      return {
        success: true,
        transactionId,
        error: "No client webhook URL configured",
      };
    }

    const payload: NotificationPayloadDto = {
      event: "transaction.status.updated",
      transactionId,
      status,
      transactionHash: hash,
      timestamp: new Date().toISOString(),
    };

    try {
      const response = await firstValueFrom(
        this.httpService
          .post(clientWebhookUrl, payload, {
            headers: {
              "Content-Type": "application/json",
            },
            timeout: this.NOTIFICATION_TIMEOUT_MS,
          })
          .pipe(
            timeout(this.NOTIFICATION_TIMEOUT_MS),
            catchError((error) => {
              this.logger.warn(
                `Notification failed for ${transactionId}: ${error.message}`,
              );
              return of({ data: null, status: error.response?.status || 0 });
            }),
          ),
      );

      if (response.status >= 200 && response.status < 300) {
        this.logger.log(
          `Notification sent for ${transactionId}: status=${status}`,
        );
        return {
          success: true,
          transactionId,
          statusCode: response.status,
        };
      }

      this.logger.warn(
        `Notification failed for ${transactionId}: HTTP ${response.status}`,
      );
      return {
        success: false,
        transactionId,
        statusCode: response.status,
        error: `HTTP ${response.status}`,
      };
    } catch (error) {
      this.logger.error(
        `Notification error for ${transactionId}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return {
        success: false,
        transactionId,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
