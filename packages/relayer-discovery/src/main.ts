import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { DiscoveryModule } from "./discovery.module";

async function bootstrap() {
  const logger = new Logger("Bootstrap");

  const app = await NestFactory.create(DiscoveryModule, {
    logger: ["log", "error", "warn", "debug"],
  });

  const port = process.env.PORT || 3001;

  await app.listen(port);

  logger.log(`Relayer Discovery Service running on port ${port}`);
  logger.log(
    `Health check interval: ${process.env.HEALTH_CHECK_INTERVAL_MS || 10000}ms`,
  );
  logger.log(
    `Health check timeout: ${process.env.HEALTH_CHECK_TIMEOUT_MS || 500}ms`,
  );
  logger.log(`Monitoring relayer count: ${process.env.RELAYER_COUNT || 3}`);
}

bootstrap();
