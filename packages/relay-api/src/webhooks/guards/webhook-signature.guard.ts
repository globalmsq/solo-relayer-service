import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { Request } from "express";

/**
 * WebhookSignatureGuard - HMAC-SHA256 Signature Verification
 *
 * SPEC-WEBHOOK-001: T-WEBHOOK-003 - Webhook signature verification
 *
 * Validates incoming webhook requests from OZ Relayer using HMAC-SHA256.
 * The signature is expected in the X-OZ-Signature header.
 *
 * Algorithm:
 * 1. Extract signature from X-OZ-Signature header
 * 2. Compute expected signature: HMAC-SHA256(payload, WEBHOOK_SIGNING_KEY)
 * 3. Compare using timing-safe equality
 * 4. Reject if mismatch (401 Unauthorized)
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const signature = request.headers["x-oz-signature"] as string;

    if (!signature) {
      this.logger.warn("Webhook request missing X-OZ-Signature header");
      throw new UnauthorizedException("Missing webhook signature");
    }

    const signingKey = this.configService.get<string>("WEBHOOK_SIGNING_KEY");

    if (!signingKey) {
      this.logger.error("WEBHOOK_SIGNING_KEY not configured");
      throw new UnauthorizedException("Webhook signature verification failed");
    }

    const payload = JSON.stringify(request.body);
    const expectedSignature = crypto
      .createHmac("sha256", signingKey)
      .update(payload)
      .digest("hex");

    // Use timing-safe comparison to prevent timing attacks
    const isValid = this.timingSafeEqual(signature, expectedSignature);

    if (!isValid) {
      this.logger.warn("Invalid webhook signature received");
      throw new UnauthorizedException("Invalid webhook signature");
    }

    this.logger.debug("Webhook signature verified successfully");
    return true;
  }

  /**
   * Timing-safe string comparison to prevent timing attacks
   */
  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    try {
      return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
      return false;
    }
  }
}
