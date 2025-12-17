import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { HealthModule } from "./health/health.module";
import { AppConfigModule } from "./config/config.module";
import { CommonModule } from "./common/common.module";
import { AuthModule } from "./auth/auth.module";
import { OzRelayerModule } from "./oz-relayer/oz-relayer.module";
import { RelayModule } from "./relay/relay.module";

@Module({
  imports: [
    HttpModule,
    AppConfigModule,
    CommonModule,
    AuthModule,
    OzRelayerModule,
    RelayModule,
    HealthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
