import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

const logger = new Logger("Bootstrap");

/**
 * Validate required environment variables for production deployment
 */
function validateEnvironmentVariables(): void {
  const requiredVars = ["RELAY_API_KEY"];
  const missingVars = requiredVars.filter((v) => !process.env[v]);

  if (missingVars.length > 0) {
    logger.error(
      `Missing required environment variables: ${missingVars.join(", ")}`,
    );
    process.exit(1);
  }

  // Reject weak placeholder values
  const weakPlaceholders = ["your-api-key-here", "your-api-key"];
  if (weakPlaceholders.includes(process.env.RELAY_API_KEY || "")) {
    logger.error(
      "Insecure RELAY_API_KEY detected. Please generate a secure API key.",
    );
    process.exit(1);
  }
}

async function bootstrap() {
  // Validate environment variables
  validateEnvironmentVariables();

  const app = await NestFactory.create(AppModule);

  // Global prefix for all routes
  app.setGlobalPrefix("api/v1");

  // Enable CORS
  app.enableCors();

  // Swagger/OpenAPI configuration
  const swaggerConfig = new DocumentBuilder()
    .setTitle("MSQ Relayer Service API")
    .setDescription("Meta Transaction Relay Infrastructure API Documentation")
    .setVersion("1.0.0")
    .addApiKey({ type: "apiKey", name: "x-api-key", in: "header" }, "api-key")
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.log(`MSQ Relayer API Gateway is running on port ${port}`);
  logger.log(`Health check: http://localhost:${port}/api/v1/health`);
  logger.log(`Swagger UI: http://localhost:${port}/api/docs`);
  logger.log(`OpenAPI JSON: http://localhost:${port}/api/docs-json`);
}

bootstrap();
