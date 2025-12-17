import { Module } from "@nestjs/common";
import { OzRelayerModule } from "../oz-relayer/oz-relayer.module";

@Module({
  imports: [OzRelayerModule],
  controllers: [], // Phase 2+: Add controllers
  providers: [],
})
export class RelayModule {}
