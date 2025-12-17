import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { ApiKeyGuard } from "./api-key.guard";

describe("ApiKeyGuard", () => {
  let guard: ApiKeyGuard;

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  function createMockExecutionContext(
    request: { headers?: Record<string, string> } = {},
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: request.headers || {},
        }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: API key is configured
    mockConfigService.get.mockReturnValue("secret-key-123");

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyGuard,
        {
          provide: Reflector,
          useValue: mockReflector,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    guard = module.get<ApiKeyGuard>(ApiKeyGuard);
  });

  describe("@Public() decorator bypass", () => {
    it("should allow access to @Public() decorated endpoints without API key", () => {
      mockReflector.getAllAndOverride.mockReturnValue(true);

      const context = createMockExecutionContext({ headers: {} });
      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockReflector.getAllAndOverride).toHaveBeenCalledWith("isPublic", [
        expect.any(Function),
        expect.any(Function),
      ]);
    });
  });

  describe("Valid API key", () => {
    it("should allow access with valid API key", () => {
      mockReflector.getAllAndOverride.mockReturnValue(false);

      const context = createMockExecutionContext({
        headers: { "x-api-key": "secret-key-123" },
      });

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe("Invalid API key", () => {
    it("should reject request with invalid API key", () => {
      mockReflector.getAllAndOverride.mockReturnValue(false);

      const context = createMockExecutionContext({
        headers: { "x-api-key": "wrong-key" },
      });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow("Invalid API key");
    });
  });

  describe("Missing API key", () => {
    it("should reject request with missing API key header", () => {
      mockReflector.getAllAndOverride.mockReturnValue(false);

      const context = createMockExecutionContext({ headers: {} });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow("Invalid API key");
    });
  });

  describe("Constructor validation", () => {
    it("should throw error if RELAY_API_KEY is not configured", async () => {
      mockConfigService.get.mockReturnValue(undefined);

      await expect(
        Test.createTestingModule({
          providers: [
            ApiKeyGuard,
            {
              provide: Reflector,
              useValue: mockReflector,
            },
            {
              provide: ConfigService,
              useValue: mockConfigService,
            },
          ],
        }).compile(),
      ).rejects.toThrow("RELAY_API_KEY environment variable is required");
    });
  });

  describe("Case sensitivity", () => {
    it("should reject API key with different case", () => {
      mockReflector.getAllAndOverride.mockReturnValue(false);

      const context = createMockExecutionContext({
        headers: { "x-api-key": "SECRET-KEY-123" },
      });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow("Invalid API key");
    });
  });
});
