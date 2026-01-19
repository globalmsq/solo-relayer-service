import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HttpModule } from "@nestjs/axios";
import { StatusController } from "./controllers/status.controller";
import { DiscoveryService } from "./services/discovery.service";
import { RedisService } from "./services/redis.service";
import discoveryConfig from "./config/discovery.config";

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [discoveryConfig],
      isGlobal: true,
    }),
    HttpModule,
  ],
  controllers: [StatusController],
  providers: [DiscoveryService, RedisService],
})
export class DiscoveryModule {}
