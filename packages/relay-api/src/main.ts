import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

/**
 * Validate required environment variables for production deployment
 */
function validateEnvironmentVariables(): void {
  const requiredVars = ["RELAY_API_KEY"];
  const missingVars = requiredVars.filter((v) => !process.env[v]);

  if (missingVars.length > 0) {
    console.error(
      `[ERROR] Missing required environment variables: ${missingVars.join(", ")}`
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
    .setDescription(
      "Meta Transaction Relay Infrastructure API Documentation"
    )
    .setVersion("1.0.0")
    .addApiKey(
      { type: "apiKey", name: "x-api-key", in: "header" },
      "api-key"
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`MSQ Relayer API Gateway is running on port ${port}`);
  console.log(`Health check: http://localhost:${port}/api/v1/health`);
  console.log(`Swagger UI: http://localhost:${port}/api/docs`);
  console.log(`OpenAPI JSON: http://localhost:${port}/api/docs-json`);
}

bootstrap();
