import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import {
  HealthCheckService,
  HealthCheckError,
  TerminusModule,
} from "@nestjs/terminus";
import { ServiceUnavailableException } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { RedisHealthIndicator, SqsHealthIndicator } from "./indicators";
import { RedisService } from "../redis/redis.service";

/**
 * HealthController Unit Tests
 *
 * SPEC-DISCOVERY-001: OZ Relayer health check removed
 * Tests health checks for Redis and SQS only
 */
describe("HealthController (Integration)", () => {
  let controller: HealthController;
  let healthCheckService: HealthCheckService;
  let redisHealth: RedisHealthIndicator;
  let sqsHealth: SqsHealthIndicator;

  // Mock SQS client send function
  const mockSqsSend = jest.fn();

  beforeEach(async () => {
    mockSqsSend.mockResolvedValue({
      Attributes: {
        ApproximateNumberOfMessages: "0",
        ApproximateNumberOfMessagesNotVisible: "0",
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        RedisHealthIndicator,
        SqsHealthIndicator,
        {
          provide: RedisService,
          useValue: {
            healthCheck: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              if (key === "sqs.endpoint") {
                return "http://localhost:4566";
              }
              if (key === "sqs.queueUrl") {
                return "http://localhost:4566/000000000000/test-queue";
              }
              if (key === "sqs.region") {
                return "ap-northeast-2";
              }
              if (key === "sqs.accessKeyId") {
                return "test";
              }
              if (key === "sqs.secretAccessKey") {
                return "test";
              }
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    // Replace SQS client's send method with mock
    sqsHealth = module.get<SqsHealthIndicator>(SqsHealthIndicator);
    (sqsHealth as any).client = { send: mockSqsSend };

    controller = module.get<HealthController>(HealthController);
    healthCheckService = module.get<HealthCheckService>(HealthCheckService);
    redisHealth = module.get<RedisHealthIndicator>(RedisHealthIndicator);
  });

  describe("check (GET /api/v1/health)", () => {
    it("should return health check result when all services are healthy", async () => {
      const result = await controller.check();

      expect(result.status).toBe("ok");
      expect(result.info).toBeDefined();
      expect(result.error).toBeDefined();
      expect(result.details).toBeDefined();
    });

    it("should return standard @nestjs/terminus response format", async () => {
      const result = await controller.check();

      // Verify standard format
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("info");
      expect(result).toHaveProperty("error");
      expect(result).toHaveProperty("details");

      // Verify status value
      expect(result.status).toBe("ok");

      // Verify info contains services (Redis and SQS only)
      expect(result.info!["redis"]).toBeDefined();
      expect(result.info!["sqs"]).toBeDefined();

      // Verify error is object (empty when all healthy)
      expect(typeof result.error).toBe("object");

      // Verify details
      expect(result.details!["redis"]).toBeDefined();
      expect(result.details!["sqs"]).toBeDefined();
    });

    it("should include redis indicator in response", async () => {
      const result = await controller.check();

      expect(result.info!["redis"].status).toBe("up");
    });

    it("should include sqs indicator in response", async () => {
      const result = await controller.check();

      expect(result.info!["sqs"]).toBeDefined();
      expect(result.info!["sqs"].status).toBe("up");
    });

    it("should throw ServiceUnavailableException when Redis is unhealthy", async () => {
      jest.spyOn(redisHealth, "isHealthy").mockRejectedValue(
        new HealthCheckError("Redis unhealthy", {
          redis: {
            status: "down",
            error: "Connection refused",
          },
        }),
      );

      try {
        await controller.check();
        fail("Should have thrown ServiceUnavailableException");
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceUnavailableException);
      }
    });

    it("should throw ServiceUnavailableException when SQS is unhealthy", async () => {
      jest.spyOn(sqsHealth, "isHealthy").mockRejectedValue(
        new HealthCheckError("SQS unhealthy", {
          sqs: {
            status: "down",
            error: "Connection refused",
          },
        }),
      );

      try {
        await controller.check();
        fail("Should have thrown ServiceUnavailableException");
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceUnavailableException);
      }
    });
  });

  describe("Controller injection", () => {
    it("should have HealthCheckService injected", () => {
      expect(healthCheckService).toBeDefined();
    });

    it("should have RedisHealthIndicator injected", () => {
      expect(redisHealth).toBeDefined();
    });

    it("should have SqsHealthIndicator injected", () => {
      expect(sqsHealth).toBeDefined();
    });

    it("should be controller instantiated", () => {
      expect(controller).toBeDefined();
      expect(controller).toBeInstanceOf(HealthController);
    });
  });
});
