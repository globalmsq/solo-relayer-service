import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * SPEC-DISCOVERY-001 Phase 2: Redis Module for Queue Consumer
 *
 * Provides Redis connectivity for retrieving active relayer list
 * from the relayer-discovery service.
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
