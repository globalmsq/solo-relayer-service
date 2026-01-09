import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiHeader,
  ApiBody,
} from "@nestjs/swagger";
import { WebhooksService } from "./webhooks.service";
import { WebhookSignatureGuard } from "./guards/webhook-signature.guard";
import { Public } from "../auth/decorators/public.decorator";
import {
  OzRelayerWebhookDto,
  WebhookResponseDto,
} from "./dto/oz-relayer-webhook.dto";

/**
 * WebhooksController - OZ Relayer Webhook Endpoint
 *
 * SPEC-WEBHOOK-001: T-WEBHOOK-002 - Webhook endpoint
 *
 * Receives transaction status updates from OZ Relayer.
 * Protected by HMAC-SHA256 signature verification.
 *
 * Endpoint: POST /api/v1/webhooks/oz-relayer
 */
@ApiTags("Webhooks")
@Controller("webhooks")
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * Receive OZ Relayer webhook
   *
   * Called by OZ Relayer when transaction status changes.
   * Signature verification via X-OZ-Signature header.
   *
   * @param payload - OZ Relayer webhook payload
   * @returns WebhookResponseDto acknowledgement
   */
  @Post("oz-relayer")
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(WebhookSignatureGuard)
  @ApiOperation({
    summary: "Receive OZ Relayer webhook",
    description:
      "Receives transaction status updates from OZ Relayer. " +
      "Protected by HMAC-SHA256 signature verification via X-OZ-Signature header.",
  })
  @ApiHeader({
    name: "X-OZ-Signature",
    description: "HMAC-SHA256 signature of the request body",
    required: true,
  })
  @ApiBody({
    type: OzRelayerWebhookDto,
    description: "OZ Relayer webhook payload",
  })
  @ApiResponse({
    status: 200,
    description: "Webhook processed successfully",
    type: WebhookResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Invalid request payload",
  })
  @ApiResponse({
    status: 401,
    description: "Invalid or missing webhook signature",
  })
  @ApiResponse({
    status: 500,
    description: "Internal server error during webhook processing",
  })
  async handleOzRelayerWebhook(
    @Body() payload: OzRelayerWebhookDto,
  ): Promise<WebhookResponseDto> {
    // DEBUG: Log raw payload to understand OZ Relayer's actual structure
    this.logger.debug(
      `Raw webhook payload: ${JSON.stringify(payload, null, 2)}`,
    );

    // Extract transaction ID from nested payload structure
    const ozRelayerTxId = payload.payload?.id;
    const status = payload.payload?.status;

    this.logger.log(
      `Received webhook event=${payload.event} for ozRelayerTxId=${ozRelayerTxId}: status=${status}`,
    );

    return this.webhooksService.handleWebhook(payload);
  }
}
