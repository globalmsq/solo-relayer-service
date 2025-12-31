import { Module, Global } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/**
 * PrismaModule
 * Global module that provides PrismaService to entire application.
 * Ensures single connection instance across all modules.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
