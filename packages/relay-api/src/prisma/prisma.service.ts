import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * PrismaService
 * Manages database connection and provides Prisma client instance globally.
 * Implements NestJS lifecycle hooks for proper connection management.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Initialize Prisma connection when NestJS module is initialized
   */
  async onModuleInit() {
    await this.$connect();
    this.logger.log("Prisma connected to database");
  }

  /**
   * Disconnect Prisma when NestJS module is destroyed
   */
  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log("Prisma disconnected from database");
  }
}
