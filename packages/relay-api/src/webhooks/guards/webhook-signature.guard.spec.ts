import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { WebhookSignatureGuard } from "./webhook-signature.guard";

describe("WebhookSignatureGuard", () => {
  let guard: WebhookSignatureGuard;
  let configService: ConfigService;

  const signingKey = "test-webhook-signing-key-32-chars";

  const createMockExecutionContext = (
    body: object,
    signature?: string,
    includeRawBody = true,
  ): ExecutionContext => {
    // SPEC-ROUTING-001: rawBody is required for HMAC signature verification
    // The guard uses rawBody (Buffer) instead of JSON.stringify(body) for security
    const rawBody = Buffer.from(JSON.stringify(body));
    const mockRequest = {
      body,
      headers: signature ? { "x-oz-signature": signature } : {},
      ...(includeRawBody && { rawBody }),
    };

    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as ExecutionContext;
  };

  const generateValidSignature = (body: object): string => {
    const payload = JSON.stringify(body);
    // OZ Relayer sends Base64 encoded HMAC-SHA256 signature
    return crypto
      .createHmac("sha256", signingKey)
      .update(payload)
      .digest("base64");
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookSignatureGuard,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === "WEBHOOK_SIGNING_KEY") return signingKey;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    guard = module.get<WebhookSignatureGuard>(WebhookSignatureGuard);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("canActivate", () => {
    it("should return true for valid signature", () => {
      const body = {
        transactionId: "tx_test123",
        status: "confirmed",
        createdAt: "2025-12-30T10:00:00.000Z",
      };

      const signature = generateValidSignature(body);
      const context = createMockExecutionContext(body, signature);

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it("should throw UnauthorizedException for missing signature header", () => {
      const body = { transactionId: "tx_test123", status: "confirmed" };
      const context = createMockExecutionContext(body);

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow(
        "Missing webhook signature",
      );
    });

    it("should throw UnauthorizedException for invalid signature", () => {
      const body = { transactionId: "tx_test123", status: "confirmed" };
      const invalidSignature = "invalid-signature-hash";
      const context = createMockExecutionContext(body, invalidSignature);

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow(
        "Invalid webhook signature",
      );
    });

    it("should throw UnauthorizedException when WEBHOOK_SIGNING_KEY is not configured", () => {
      jest.spyOn(configService, "get").mockReturnValue(undefined);

      const body = { transactionId: "tx_test123", status: "confirmed" };
      const context = createMockExecutionContext(body, "any-signature");

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow(
        "Webhook signature verification failed",
      );
    });

    it("should throw UnauthorizedException when rawBody is not available", () => {
      const body = { transactionId: "tx_test123", status: "confirmed" };
      const signature = generateValidSignature(body);
      // SPEC-ROUTING-001: rawBody is required for secure HMAC verification
      const context = createMockExecutionContext(body, signature, false);

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow(
        "Webhook signature verification failed",
      );
    });

    it("should reject tampered payload", () => {
      const originalBody = { transactionId: "tx_test123", status: "confirmed" };
      const tamperedBody = { transactionId: "tx_test123", status: "failed" };

      const signature = generateValidSignature(originalBody);
      const context = createMockExecutionContext(tamperedBody, signature);

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it("should handle complex nested payload", () => {
      const body = {
        transactionId: "tx_test123",
        status: "confirmed",
        hash: "0xabcd1234",
        from: "0x1234",
        to: "0x5678",
        value: "1000000000000000000",
        createdAt: "2025-12-30T10:00:00.000Z",
        confirmedAt: "2025-12-30T10:05:00.000Z",
      };

      const signature = generateValidSignature(body);
      const context = createMockExecutionContext(body, signature);

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it("should be timing-attack resistant (signatures of different lengths)", () => {
      const body = { transactionId: "tx_test123", status: "confirmed" };
      const shortSignature = "abc";
      const context = createMockExecutionContext(body, shortSignature);

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });
  });
});
