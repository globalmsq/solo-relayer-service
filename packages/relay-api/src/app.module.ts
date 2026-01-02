import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { HealthModule } from "./health/health.module";
import { AppConfigModule } from "./config/config.module";
import { CommonModule } from "./common/common.module";
import { AuthModule } from "./auth/auth.module";
import { OzRelayerModule } from "./oz-relayer/oz-relayer.module";
import { RelayModule } from "./relay/relay.module";
import { RedisModule } from "./redis/redis.module";
import { PrismaModule } from "./prisma/prisma.module";
import { WebhooksModule } from "./webhooks/webhooks.module";

@Module({
  imports: [
    HttpModule,
    AppConfigModule,
    RedisModule,
    PrismaModule,
    CommonModule,
    AuthModule,
    OzRelayerModule,
    RelayModule,
    WebhooksModule,
    HealthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
