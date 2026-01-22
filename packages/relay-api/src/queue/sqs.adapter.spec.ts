import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { SqsAdapter } from "./sqs.adapter";

/**
 * SqsAdapter Unit Tests
 *
 * SPEC-QUEUE-001: AWS SQS Queue System - Producer Adapter
 *
 * Tests for SqsAdapter message sending functionality with dual credentials
 * (LocalStack for development, IAM Role for production)
 */
describe("SqsAdapter", () => {
  let adapter: SqsAdapter;
  let mockSend: jest.Mock;

  // Create mock ConfigService factory
  const createMockConfigService = (
    config: Record<string, string | undefined>,
  ) => ({
    get: jest.fn().mockImplementation((key: string) => config[key]),
  });

  // Valid LocalStack configuration
  const validLocalConfig = {
    "sqs.endpoint": "http://localhost:4566",
    "sqs.queueUrl": "http://localhost:4566/000000000000/test-queue",
    "sqs.region": "ap-northeast-2",
    "sqs.accessKeyId": "test",
    "sqs.secretAccessKey": "test",
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSend = jest.fn();

    // Create module with valid config (needed for sendMessage tests)
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SqsAdapter,
        {
          provide: ConfigService,
          useValue: createMockConfigService(validLocalConfig),
        },
      ],
    }).compile();

    adapter = module.get<SqsAdapter>(SqsAdapter);

    // Replace the internal client's send method with our mock
    (adapter as any).client = { send: mockSend };
  });

  describe("initialization", () => {
    it("should throw error if SQS_QUEUE_URL is not configured", () => {
      // Arrange
      const mockConfigService = createMockConfigService({
        "sqs.queueUrl": undefined,
        "sqs.region": "ap-northeast-2",
      });

      // Act & Assert
      expect(
        () => new SqsAdapter(mockConfigService as unknown as ConfigService),
      ).toThrow("SQS_QUEUE_URL environment variable is required");
    });

    it("should throw error if AWS_REGION is not configured", () => {
      // Arrange
      const mockConfigService = createMockConfigService({
        "sqs.queueUrl": "http://localhost:4566/000000000000/test-queue",
        "sqs.region": undefined,
      });

      // Act & Assert
      expect(
        () => new SqsAdapter(mockConfigService as unknown as ConfigService),
      ).toThrow("AWS_REGION environment variable is required");
    });

    it("should initialize with LocalStack credentials when endpoint is provided", () => {
      // Arrange
      const mockConfigService = createMockConfigService(validLocalConfig);

      // Act
      const localAdapter = new SqsAdapter(
        mockConfigService as unknown as ConfigService,
      );

      // Assert - adapter should be created without error
      expect(localAdapter).toBeDefined();
    });

    it("should initialize without explicit credentials for production (IAM Role)", () => {
      // Arrange - no endpoint means production
      const mockConfigService = createMockConfigService({
        "sqs.endpoint": undefined, // No endpoint = production
        "sqs.queueUrl":
          "https://sqs.ap-northeast-2.amazonaws.com/123456789/relay-transactions",
        "sqs.region": "ap-northeast-2",
      });

      // Act
      const prodAdapter = new SqsAdapter(
        mockConfigService as unknown as ConfigService,
      );

      // Assert - adapter should be created without error
      expect(prodAdapter).toBeDefined();
    });
  });

  describe("sendMessage", () => {
    it("should send message with JSON-serialized body", async () => {
      // Arrange
      const messageBody = {
        transactionId: "550e8400-e29b-41d4-a716-446655440000",
        type: "direct",
        request: { to: "0x1234", data: "0x", value: "1000" },
      };

      mockSend.mockResolvedValueOnce({ MessageId: "msg-123" });

      // Act
      await adapter.sendMessage(messageBody);

      // Assert
      expect(mockSend).toHaveBeenCalledTimes(1);
      // AWS SDK command has input property containing the actual parameters
      const call = mockSend.mock.calls[0][0];
      expect(call.input.QueueUrl).toBe(validLocalConfig["sqs.queueUrl"]);
      expect(call.input.MessageBody).toBe(JSON.stringify(messageBody));
    });

    it("should throw error when SQS send fails", async () => {
      // Arrange
      const messageBody = {
        transactionId: "550e8400-e29b-41d4-a716-446655440000",
        type: "direct",
        request: { to: "0x1234", data: "0x" },
      };

      const sqsError = new Error("SQS service unavailable");
      mockSend.mockRejectedValueOnce(sqsError);

      // Act & Assert
      await expect(adapter.sendMessage(messageBody)).rejects.toThrow(
        "SQS service unavailable",
      );
    });

    it("should handle empty object message body", async () => {
      // Arrange
      const messageBody = {};
      mockSend.mockResolvedValueOnce({ MessageId: "msg-456" });

      // Act
      await adapter.sendMessage(messageBody);

      // Assert
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });
});
