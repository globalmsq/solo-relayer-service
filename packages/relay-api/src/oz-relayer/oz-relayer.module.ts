import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { OzRelayerService } from "./oz-relayer.service";

@Module({
  imports: [HttpModule],
  providers: [OzRelayerService],
  exports: [OzRelayerService],
})
export class OzRelayerModule {}
