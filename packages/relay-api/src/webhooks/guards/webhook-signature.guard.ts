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

    // DEBUG: Log all incoming headers to find the correct signature header name
    this.logger.debug(
      `Incoming webhook headers: ${JSON.stringify(request.headers, null, 2)}`,
    );

    // Try multiple possible header names (OZ Relayer might use different names)
    const signature =
      (request.headers["x-oz-signature"] as string) ||
      (request.headers["x-signature"] as string) ||
      (request.headers["x-webhook-signature"] as string) ||
      (request.headers["x-hub-signature-256"] as string) ||
      (request.headers["signature"] as string);

    if (!signature) {
      this.logger.warn(
        `Webhook request missing signature header. Available headers: ${Object.keys(request.headers).join(", ")}`,
      );
      throw new UnauthorizedException("Missing webhook signature");
    }

    this.logger.debug(`Found signature in header: ${signature.substring(0, 20)}...`);

    const signingKey = this.configService.get<string>("WEBHOOK_SIGNING_KEY");

    if (!signingKey) {
      this.logger.error("WEBHOOK_SIGNING_KEY not configured");
      throw new UnauthorizedException("Webhook signature verification failed");
    }

    // SPEC-ROUTING-001: Use raw body for HMAC calculation
    // JSON.stringify(request.body) is insecure - it may produce different bytes than original
    // Raw body preserves exact bytes sent by OZ Relayer
    const rawBody = (request as any).rawBody as Buffer | undefined;
    if (!rawBody) {
      this.logger.error(
        "Raw body not available for signature verification. Ensure body-parser is configured with verify callback.",
      );
      throw new UnauthorizedException("Webhook signature verification failed");
    }

    // OZ Relayer sends Base64 encoded HMAC-SHA256 signature
    const expectedSignature = crypto
      .createHmac("sha256", signingKey)
      .update(rawBody)
      .digest("base64");

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
