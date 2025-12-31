import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";
import { NotificationService } from "./notification.service";
import { WebhookSignatureGuard } from "./guards/webhook-signature.guard";

/**
 * WebhooksModule - OZ Relayer Webhook Integration
 *
 * SPEC-WEBHOOK-001: Webhook Module
 *
 * Provides webhook handling functionality:
 * - OZ Relayer webhook reception (POST /webhooks/oz-relayer)
 * - HMAC-SHA256 signature verification
 * - Redis + MySQL write-through updates
 * - Client notification service
 *
 * Dependencies:
 * - PrismaModule (Global) - MySQL access
 * - RedisModule (Global) - Redis cache access
 * - ConfigModule (Global) - Environment configuration
 * - HttpModule - Client notification HTTP calls
 */
@Module({
  imports: [
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 3,
    }),
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, NotificationService, WebhookSignatureGuard],
  exports: [WebhooksService, NotificationService],
})
export class WebhooksModule {}
