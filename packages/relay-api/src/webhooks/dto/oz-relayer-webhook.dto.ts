import { IsString, IsOptional, IsNotEmpty, IsIn } from "class-validator";

/**
 * OZ Relayer Webhook Payload DTO
 *
 * SPEC-WEBHOOK-001: E-WEBHOOK-002 - Webhook payload from OZ Relayer
 *
 * Received when OZ Relayer sends transaction status updates via webhook.
 * Signature is verified via X-OZ-Signature header (HMAC-SHA256).
 */
export class OzRelayerWebhookDto {
  @IsString()
  @IsNotEmpty()
  transactionId: string;

  @IsString()
  @IsOptional()
  hash?: string | null;

  @IsString()
  @IsNotEmpty()
  @IsIn([
    "pending",
    "sent",
    "submitted",
    "inmempool",
    "mined",
    "confirmed",
    "failed",
  ])
  status: string;

  @IsString()
  @IsOptional()
  from?: string;

  @IsString()
  @IsOptional()
  to?: string;

  @IsString()
  @IsOptional()
  value?: string;

  @IsString()
  @IsNotEmpty()
  createdAt: string;

  @IsString()
  @IsOptional()
  confirmedAt?: string;
}

/**
 * Webhook Response DTO
 *
 * Standard acknowledgement response for webhook processing.
 */
export class WebhookResponseDto {
  success: boolean;
  message: string;
  transactionId?: string;
}
