// Set environment variables BEFORE any module imports
// This is critical for SqsAdapter which validates env vars in constructor
process.env.SQS_QUEUE_URL =
  "http://localhost:4566/000000000000/relay-transactions";
process.env.SQS_DLQ_URL =
  "http://localhost:4566/000000000000/relay-transactions-dlq";
process.env.SQS_ENDPOINT_URL = "http://localhost:4566";
process.env.AWS_REGION = "ap-northeast-2";
process.env.AWS_ACCESS_KEY_ID = "test";
process.env.AWS_SECRET_ACCESS_KEY = "test";

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as bodyParser from "body-parser";
import { HttpService } from "@nestjs/axios";
import { of } from "rxjs";
import { AppModule } from "../../src/app.module";
import { GaslessService } from "../../src/relay/gasless/gasless.service";
import { StatusModule } from "../../src/relay/status/status.module";
import { RedisService } from "../../src/redis/redis.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { SqsAdapter } from "../../src/queue/sqs.adapter";
import { TEST_CONFIG } from "../fixtures/test-config";

// Shared config map (no duplication)
// SPEC-DISCOVERY-001: OZ_RELAYER_URL removed - transactions processed via queue-consumer
const configMap: Record<string, any> = {
  RELAY_API_KEY: TEST_CONFIG.api.key,
  apiKey: TEST_CONFIG.api.key,
  FORWARDER_ADDRESS: TEST_CONFIG.forwarder.address,
  FORWARDER_NAME: TEST_CONFIG.forwarder.name,
  CHAIN_ID: TEST_CONFIG.forwarder.chain_id,
  RPC_URL: "http://localhost:8545",
  WEBHOOK_SIGNING_KEY: TEST_CONFIG.webhook.signing_key,
  CLIENT_WEBHOOK_URL: TEST_CONFIG.webhook.client_url,
  // SQS Configuration (SPEC-QUEUE-001)
  SQS_QUEUE_URL: "http://localhost:4566/000000000000/relay-transactions",
  SQS_DLQ_URL: "http://localhost:4566/000000000000/relay-transactions-dlq",
  SQS_ENDPOINT_URL: "http://localhost:4566",
  AWS_REGION: "ap-northeast-2",
  AWS_ACCESS_KEY_ID: "test",
  AWS_SECRET_ACCESS_KEY: "test",
  // SQS nested config keys (for ConfigService.get())
  "sqs.endpoint": "http://localhost:4566",
  "sqs.queueUrl": "http://localhost:4566/000000000000/relay-transactions",
  "sqs.dlqUrl": "http://localhost:4566/000000000000/relay-transactions-dlq",
  "sqs.region": "ap-northeast-2",
  "sqs.accessKeyId": "test",
  "sqs.secretAccessKey": "test",
};

// Default mock for Redis client (ioredis instance) - Prevents real Redis connections
export const defaultRedisClientMock = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue("OK"),
  del: jest.fn().mockResolvedValue(1),
  exists: jest.fn().mockResolvedValue(0),
  ttl: jest.fn().mockResolvedValue(-1),
  flushall: jest.fn().mockResolvedValue("OK"),
  ping: jest.fn().mockResolvedValue("PONG"),
  quit: jest.fn().mockResolvedValue("OK"),
  disconnect: jest.fn(),
  on: jest.fn(),
};

// Default mock for RedisService (L1 Cache)
export const defaultRedisMock = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockResolvedValue(false),
  ttl: jest.fn().mockResolvedValue(-1),
  flushAll: jest.fn().mockResolvedValue(undefined),
  healthCheck: jest.fn().mockResolvedValue(true),
  onModuleDestroy: jest.fn().mockResolvedValue(undefined),
};

// UUID generator for unique transaction IDs
let transactionCounter = 0;
const generateMockTransactionId = () => {
  transactionCounter++;
  return `00000000-0000-0000-0000-${String(transactionCounter).padStart(12, "0")}`;
};

// Default mock transaction data for Prisma
// Field names must match Prisma schema exactly:
// - id: Auto-increment integer PK (internal)
// - transactionId: UUID for external API
// - transactionHash: Transaction hash (nullable)
const createMockTransaction = (overrides = {}) => ({
  id: ++transactionCounter, // Integer PK (auto-increment)
  transactionId: generateMockTransactionId(), // UUID for external API
  transactionHash: "0x" + "1".repeat(64), // Transaction hash
  status: "queued", // SPEC-QUEUE-001: Default status is now "queued"
  from: "0x" + "a".repeat(40),
  to: "0x" + "b".repeat(40),
  value: "1000000000000000000",
  data: null,
  type: null,
  request: null,
  result: null,
  error_message: null,
  relayerTxId: null,
  relayerUrl: null,
  retryOnFailure: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  confirmedAt: null,
  ...overrides,
});

// Default mock for PrismaService (L2 Cache / MySQL)
// Use mockImplementation to generate unique transaction IDs per call
export const defaultPrismaMock = {
  $connect: jest.fn().mockResolvedValue(undefined),
  $disconnect: jest.fn().mockResolvedValue(undefined),
  onModuleInit: jest.fn().mockResolvedValue(undefined),
  onModuleDestroy: jest.fn().mockResolvedValue(undefined),
  transaction: {
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest
      .fn()
      .mockImplementation(() => Promise.resolve(createMockTransaction())),
    update: jest
      .fn()
      .mockImplementation(() => Promise.resolve(createMockTransaction())),
    upsert: jest
      .fn()
      .mockImplementation(() => Promise.resolve(createMockTransaction())),
    delete: jest
      .fn()
      .mockImplementation(() => Promise.resolve(createMockTransaction())),
  },
};

// Default mock for SqsAdapter (SPEC-QUEUE-001: Queue Producer)
export const defaultSqsAdapterMock = {
  sendMessage: jest.fn().mockResolvedValue(undefined),
};

// Default mock for HttpService (for RPC calls in GaslessService)
// Structure mirrors real HttpService from @nestjs/axios
export const mockAxiosPost = jest.fn().mockResolvedValue({
  data: { jsonrpc: "2.0", result: "0x0", id: 1 },
});

// Mock axiosRef object (axios instance)
const mockAxiosRef = {
  post: mockAxiosPost,
  get: jest.fn(),
  defaults: { headers: { common: {} } },
  interceptors: {
    request: { use: jest.fn(), eject: jest.fn() },
    response: { use: jest.fn(), eject: jest.fn() },
  },
};

// HttpService mock class to properly expose axiosRef as a property
class MockHttpService {
  get = jest.fn().mockReturnValue(of({ data: {}, status: 200 }));
  post = jest.fn().mockReturnValue(of({ data: {}, status: 200 }));

  // axiosRef must be a getter or property for NestJS DI to work correctly
  get axiosRef() {
    return mockAxiosRef;
  }
}

export const defaultHttpServiceMock = new MockHttpService();

// Store moduleFixture for select() access
let currentModuleFixture: TestingModule | null = null;

export async function createTestApp(): Promise<INestApplication> {
  // Set environment variables
  Object.entries(configMap).forEach(([key, value]) => {
    process.env[key] = String(value);
  });

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    // Mock ConfigService
    .overrideProvider(ConfigService)
    .useValue({
      get: jest.fn(
        (key: string, defaultValue?: any) => configMap[key] ?? defaultValue,
      ),
      getOrThrow: jest.fn((key: string) => {
        const value = configMap[key];
        if (value === undefined) throw new Error(`Config key ${key} not found`);
        return value;
      }),
    })
    // SPEC-DISCOVERY-001: OzRelayerService removed - transactions processed via queue-consumer
    // Mock HttpService with useFactory to ensure proper injection
    .overrideProvider(HttpService)
    .useFactory({
      factory: () => defaultHttpServiceMock,
    })
    // Mock REDIS_CLIENT (ioredis instance) - Critical: prevents real Redis connections
    .overrideProvider("REDIS_CLIENT")
    .useValue(defaultRedisClientMock)
    // Mock RedisService (L1 Cache)
    .overrideProvider(RedisService)
    .useValue(defaultRedisMock)
    // Mock PrismaService (L2 Cache / MySQL) - Critical: prevents real DB connections
    .overrideProvider(PrismaService)
    .useValue(defaultPrismaMock)
    // Mock SqsAdapter (SPEC-QUEUE-001) - Critical: prevents real SQS connections
    .overrideProvider(SqsAdapter)
    .useValue(defaultSqsAdapterMock)
    .compile();

  // Store for module-scoped access
  currentModuleFixture = moduleFixture;

  const app = moduleFixture.createNestApplication({
    bodyParser: false, // Disable built-in body parsing for custom rawBody preservation
  });

  // Configure body-parser with rawBody preservation (mirrors main.ts)
  // SPEC-ROUTING-001: HMAC signature must be computed on exact raw bytes
  app.use(
    bodyParser.json({
      verify: (req: any, _res: any, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(bodyParser.urlencoded({ extended: true }));

  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();

  // CRITICAL: Setup service mocks to avoid real RPC/HTTP calls
  // Spies on GaslessService.getNonceFromForwarder and StatusModule's HttpService
  setupServiceMocks(moduleFixture);

  return app;
}

// Store spied GaslessService instance
let gaslessServiceSpy: jest.SpyInstance | null = null;

/**
 * Setup service mocks for the test application
 * - Spies on GaslessService.getNonceFromForwarder to avoid real RPC calls
 * - Spies on StatusModule's HttpService for status polling
 */
function setupServiceMocks(moduleFixture: TestingModule): void {
  // Spy on GaslessService.getNonceFromForwarder to avoid real RPC calls
  try {
    const gaslessService = moduleFixture.get(GaslessService);
    gaslessServiceSpy = jest
      .spyOn(gaslessService, "getNonceFromForwarder")
      .mockResolvedValue("0");
  } catch {
    // GaslessService might not be available
  }

  // Spy on HttpService from StatusModule context (for OZ Relayer status calls)
  try {
    const statusHttpService = moduleFixture
      .select(StatusModule)
      .get(HttpService, { strict: false });
    if (statusHttpService) {
      jest.spyOn(statusHttpService, "get").mockReturnValue(
        of({
          data: {},
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as never,
        }),
      );
    }
  } catch {
    // StatusModule HttpService might not be available
  }

  // Also spy on root-level HttpService for status endpoint fallback
  try {
    const rootHttpService = moduleFixture.get(HttpService, { strict: false });
    if (rootHttpService) {
      jest.spyOn(rootHttpService, "get").mockReturnValue(
        of({
          data: {},
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as never,
        }),
      );
    }
  } catch {
    // Root HttpService might not be available
  }
}

// SPEC-DISCOVERY-001: getOzRelayerServiceMock removed - OZ Relayer no longer used in relay-api

/**
 * Type for mocked HttpService with spied methods
 */
export type MockedHttpService = {
  get: jest.SpyInstance;
  post: jest.SpyInstance;
  axiosRef: {
    post: jest.SpyInstance;
    get: jest.SpyInstance;
  };
};

/**
 * Helper to get HttpService mock for StatusModule (status polling)
 * Returns the StatusModule's HttpService with spy methods
 * @example
 * const httpMock = getHttpServiceMock(app);
 * httpMock.get.mockReturnValueOnce(of({ data: {...}, status: 200 }));
 */
export function getHttpServiceMock(app: INestApplication): MockedHttpService {
  // Get HttpService from StatusModule context
  if (currentModuleFixture) {
    try {
      const statusHttpService = currentModuleFixture
        .select(StatusModule)
        .get(HttpService, { strict: false });
      return statusHttpService as unknown as MockedHttpService;
    } catch {
      // Fall back to root HttpService
    }
  }
  return app.get(HttpService) as unknown as MockedHttpService;
}

/**
 * Helper to get GaslessService mock for RPC call manipulation
 * Returns the GaslessService with spied getNonceFromForwarder method
 * @example
 * const gaslessMock = getGaslessServiceMock(app);
 * gaslessMock.getNonceFromForwarder.mockRejectedValueOnce(new Error('RPC unavailable'));
 */
export function getGaslessServiceMock(
  app: INestApplication,
): jest.Mocked<GaslessService> {
  return app.get(GaslessService) as jest.Mocked<GaslessService>;
}

/**
 * Helper to get SqsAdapter mock for queue failure simulation
 * Returns the mocked SqsAdapter
 * @example
 * const sqsMock = getSqsAdapterMock(app);
 * sqsMock.sendMessage.mockRejectedValueOnce(new Error('SQS unavailable'));
 */
export function getSqsAdapterMock(
  app: INestApplication,
): jest.Mocked<SqsAdapter> {
  return app.get(SqsAdapter) as jest.Mocked<SqsAdapter>;
}

/**
 * Reset all mocks between tests
 * Uses mockReset() to clear both call history AND queued implementations
 * @param app - Optional app instance to reset service spies
 */
export function resetMocks(app?: INestApplication): void {
  // Reset transaction counter for unique IDs
  transactionCounter = 0;

  // SPEC-DISCOVERY-001: OzRelayerService mocks removed - transactions processed via queue-consumer

  // Reset SqsAdapter mock (SPEC-QUEUE-001)
  defaultSqsAdapterMock.sendMessage.mockReset();
  defaultSqsAdapterMock.sendMessage.mockResolvedValue(undefined);

  // Reset Prisma mocks with fresh implementation
  defaultPrismaMock.transaction.create.mockReset();
  defaultPrismaMock.transaction.create.mockImplementation(() =>
    Promise.resolve(createMockTransaction()),
  );
  defaultPrismaMock.transaction.update.mockReset();
  defaultPrismaMock.transaction.update.mockImplementation(() =>
    Promise.resolve(createMockTransaction()),
  );
  defaultPrismaMock.transaction.findUnique.mockReset();
  defaultPrismaMock.transaction.findUnique.mockResolvedValue(null);

  // Reset GaslessService spy
  if (gaslessServiceSpy) {
    gaslessServiceSpy.mockReset();
    gaslessServiceSpy.mockResolvedValue("0");
  }

  // Reset HttpService spies for StatusModule
  if (app && currentModuleFixture) {
    // Reset StatusModule HttpService
    try {
      const statusHttpService = currentModuleFixture
        .select(StatusModule)
        .get(HttpService, { strict: false });
      if (statusHttpService?.get) {
        (statusHttpService.get as unknown as jest.SpyInstance).mockReset();
        (statusHttpService.get as unknown as jest.SpyInstance).mockReturnValue(
          of({ data: {}, status: 200 }),
        );
      }
    } catch {
      // StatusModule HttpService might not be available
    }

    // Reset root HttpService
    try {
      const rootHttpService = currentModuleFixture.get(HttpService, {
        strict: false,
      });
      if (rootHttpService?.get) {
        (rootHttpService.get as unknown as jest.SpyInstance).mockReset();
        (rootHttpService.get as unknown as jest.SpyInstance).mockReturnValue(
          of({ data: {}, status: 200 }),
        );
      }
    } catch {
      // Root HttpService might not be available
    }
  }
}
