import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global prefix for all routes
  app.setGlobalPrefix("api/v1");

  // Enable CORS
  app.enableCors();

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`MSQ Relayer API Gateway is running on port ${port}`);
  console.log(`Health check: http://localhost:${port}/api/v1/health`);
}

bootstrap();
