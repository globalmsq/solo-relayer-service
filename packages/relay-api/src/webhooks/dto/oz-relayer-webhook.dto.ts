import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsIn,
  ValidateNested,
  IsNumber,
} from "class-validator";
import { Type } from "class-transformer";

/**
 * OZ Relayer Transaction Payload DTO
 *
 * The actual transaction data nested inside the webhook event.
 * OZ Relayer uses snake_case field names.
 */
export class OzRelayerTransactionPayloadDto {
  @IsString()
  @IsNotEmpty()
  payload_type: string;

  @IsString()
  @IsNotEmpty()
  id: string; // OZ Relayer's internal transaction ID (ozRelayerTxId in our DB)

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
  status_reason?: string | null;

  @IsString()
  @IsNotEmpty()
  created_at: string;

  @IsString()
  @IsOptional()
  sent_at?: string | null;

  @IsString()
  @IsOptional()
  confirmed_at?: string | null;

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
  @IsOptional()
  gas_price?: string;

  @IsNumber()
  @IsOptional()
  gas_limit?: number;

  @IsNumber()
  @IsOptional()
  nonce?: number;

  @IsString()
  @IsOptional()
  relayer_id?: string;

  @IsString()
  @IsOptional()
  data?: string | null;
}

/**
 * OZ Relayer Webhook Event DTO
 *
 * SPEC-WEBHOOK-001: E-WEBHOOK-002 - Webhook payload from OZ Relayer
 *
 * OZ Relayer sends webhook events with a wrapper structure:
 * {
 *   "id": "event-uuid",
 *   "event": "transaction_update",
 *   "payload": { ... transaction data ... },
 *   "timestamp": "ISO8601"
 * }
 *
 * Signature is verified via X-OZ-Signature header (HMAC-SHA256 Base64).
 */
export class OzRelayerWebhookDto {
  @IsString()
  @IsNotEmpty()
  id: string; // Webhook event ID (NOT transaction ID)

  @IsString()
  @IsNotEmpty()
  event: string; // Event type (e.g., "transaction_update")

  @ValidateNested()
  @Type(() => OzRelayerTransactionPayloadDto)
  payload: OzRelayerTransactionPayloadDto;

  @IsString()
  @IsNotEmpty()
  timestamp: string;
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
