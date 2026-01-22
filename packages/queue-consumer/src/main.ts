import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { ConsumerModule } from "./consumer.module";

async function bootstrap() {
  const logger = new Logger("ConsumerBootstrap");

  const app = await NestFactory.create(ConsumerModule, {
    logger: ["error", "warn", "log", "debug", "verbose"],
  });

  const port = process.env.PORT || 3001;

  await app.listen(port);
  logger.log(`Queue Consumer listening on port ${port}`);
}

bootstrap().catch((err) => {
  console.error("Consumer bootstrap failed:", err);
  process.exit(1);
});
