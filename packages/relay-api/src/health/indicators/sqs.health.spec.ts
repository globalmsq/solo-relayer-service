import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { HealthCheckError } from "@nestjs/terminus";
import { SqsHealthIndicator } from "./sqs.health";

/**
 * SqsHealthIndicator Unit Tests
 *
 * SPEC-QUEUE-001: AWS SQS Queue System - Health Check
 *
 * Tests for SQS health indicator functionality
 */
describe("SqsHealthIndicator", () => {
  let indicator: SqsHealthIndicator;
  let mockSend: jest.Mock;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        "sqs.endpoint": "http://localhost:4566",
        "sqs.queueUrl": "http://localhost:4566/000000000000/test-queue",
        "sqs.region": "ap-northeast-2",
        "sqs.accessKeyId": "test",
        "sqs.secretAccessKey": "test",
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    mockSend = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SqsHealthIndicator,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    indicator = module.get<SqsHealthIndicator>(SqsHealthIndicator);

    // Replace the internal client's send method with our mock
    (indicator as any).client = { send: mockSend };
  });

  describe("isHealthy", () => {
    it("should return healthy status when SQS is reachable", async () => {
      // Arrange
      mockSend.mockResolvedValueOnce({
        Attributes: {
          ApproximateNumberOfMessages: "5",
          ApproximateNumberOfMessagesNotVisible: "2",
        },
      });

      // Act
      const result = await indicator.isHealthy("sqs");

      // Assert
      expect(result["sqs"].status).toBe("up");
      expect(result["sqs"].messagesInQueue).toBe(5);
      expect(result["sqs"].messagesInFlight).toBe(2);
    });

    it("should return zero counts when no messages in queue", async () => {
      // Arrange
      mockSend.mockResolvedValueOnce({
        Attributes: {
          ApproximateNumberOfMessages: "0",
          ApproximateNumberOfMessagesNotVisible: "0",
        },
      });

      // Act
      const result = await indicator.isHealthy("sqs");

      // Assert
      expect(result["sqs"].messagesInQueue).toBe(0);
      expect(result["sqs"].messagesInFlight).toBe(0);
    });

    it("should handle missing attributes gracefully", async () => {
      // Arrange
      mockSend.mockResolvedValueOnce({
        Attributes: {},
      });

      // Act
      const result = await indicator.isHealthy("sqs");

      // Assert
      expect(result["sqs"].status).toBe("up");
      expect(result["sqs"].messagesInQueue).toBe(0);
      expect(result["sqs"].messagesInFlight).toBe(0);
    });

    it("should throw HealthCheckError when SQS is unreachable", async () => {
      // Arrange
      mockSend.mockRejectedValueOnce(new Error("Connection refused"));

      // Act & Assert
      await expect(indicator.isHealthy("sqs")).rejects.toThrow(
        HealthCheckError,
      );
    });

    it("should include error message in HealthCheckError", async () => {
      // Arrange
      mockSend.mockRejectedValueOnce(new Error("Queue does not exist"));

      // Act & Assert
      try {
        await indicator.isHealthy("sqs");
        fail("Expected HealthCheckError to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HealthCheckError);
        expect((error as HealthCheckError).message).toContain(
          "Queue does not exist",
        );
      }
    });

    it("should return down status in error causes", async () => {
      // Arrange
      mockSend.mockRejectedValueOnce(new Error("Service unavailable"));

      // Act & Assert
      try {
        await indicator.isHealthy("sqs");
        fail("Expected HealthCheckError to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HealthCheckError);
        expect((error as HealthCheckError).causes).toHaveProperty("sqs");
        expect((error as HealthCheckError).causes["sqs"].status).toBe("down");
      }
    });
  });

  describe("Integration", () => {
    it("should be injectable with ConfigService dependency", () => {
      expect(indicator).toBeDefined();
      expect(indicator).toBeInstanceOf(SqsHealthIndicator);
    });

    it("should inherit from HealthIndicator", () => {
      expect(indicator).toHaveProperty("getStatus");
    });

    it("should respond quickly when SQS is healthy", async () => {
      // Arrange
      mockSend.mockResolvedValueOnce({
        Attributes: {
          ApproximateNumberOfMessages: "0",
          ApproximateNumberOfMessagesNotVisible: "0",
        },
      });

      // Act
      const start = Date.now();
      await indicator.isHealthy("sqs");
      const duration = Date.now() - start;

      // Assert
      expect(duration).toBeLessThan(100);
    });
  });
});
