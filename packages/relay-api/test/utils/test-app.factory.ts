import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { AppModule } from '../../src/app.module';
import { OzRelayerService } from '../../src/oz-relayer/oz-relayer.service';
import { GaslessService } from '../../src/relay/gasless/gasless.service';
import { StatusModule } from '../../src/relay/status/status.module';
import { TEST_CONFIG } from '../fixtures/test-config';
import {
  createMockOzRelayerResponse,
  createMockConfirmedResponse,
} from '../fixtures/mock-responses';

// Shared config map (no duplication)
const configMap: Record<string, any> = {
  OZ_RELAYER_URL: TEST_CONFIG.oz_relayer.url,
  OZ_RELAYER_API_KEY: TEST_CONFIG.oz_relayer.api_key,
  RELAY_API_KEY: TEST_CONFIG.api.key,
  apiKey: TEST_CONFIG.api.key,
  FORWARDER_ADDRESS: TEST_CONFIG.forwarder.address,
  FORWARDER_NAME: TEST_CONFIG.forwarder.name,
  CHAIN_ID: TEST_CONFIG.forwarder.chain_id,
  RPC_URL: 'http://localhost:8545',
};

// Default mock for OzRelayerService
const defaultOzRelayerMock = {
  sendTransaction: jest.fn().mockResolvedValue(createMockOzRelayerResponse()),
  getTransactionStatus: jest.fn().mockResolvedValue(createMockConfirmedResponse()),
  getRelayerId: jest.fn().mockResolvedValue('test-relayer-id'),
};

// Default mock for HttpService (for RPC calls in GaslessService)
// Structure mirrors real HttpService from @nestjs/axios
export const mockAxiosPost = jest.fn().mockResolvedValue({
  data: { jsonrpc: '2.0', result: '0x0', id: 1 },
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
      get: jest.fn((key: string, defaultValue?: any) => configMap[key] ?? defaultValue),
      getOrThrow: jest.fn((key: string) => {
        const value = configMap[key];
        if (value === undefined) throw new Error(`Config key ${key} not found`);
        return value;
      }),
    })
    // Mock OzRelayerService (Critical: prevents real HTTP calls to OZ Relayer)
    .overrideProvider(OzRelayerService)
    .useValue(defaultOzRelayerMock)
    // Mock HttpService with useFactory to ensure proper injection
    .overrideProvider(HttpService)
    .useFactory({
      factory: () => defaultHttpServiceMock,
    })
    .compile();

  // Store for module-scoped access
  currentModuleFixture = moduleFixture;

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api/v1');
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
    gaslessServiceSpy = jest.spyOn(gaslessService, 'getNonceFromForwarder')
      .mockResolvedValue('0');
  } catch {
    // GaslessService might not be available
  }

  // Spy on HttpService from StatusModule context (for OZ Relayer status calls)
  try {
    const statusHttpService = moduleFixture.select(StatusModule).get(HttpService, { strict: false });
    if (statusHttpService) {
      jest.spyOn(statusHttpService, 'get').mockReturnValue(of({
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      }));
    }
  } catch {
    // StatusModule HttpService might not be available
  }

  // Also spy on root-level HttpService for status endpoint fallback
  try {
    const rootHttpService = moduleFixture.get(HttpService, { strict: false });
    if (rootHttpService) {
      jest.spyOn(rootHttpService, 'get').mockReturnValue(of({
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      }));
    }
  } catch {
    // Root HttpService might not be available
  }
}

/**
 * Helper to get OzRelayerService mock for test manipulation
 * @example
 * const ozMock = getOzRelayerServiceMock(app);
 * ozMock.sendTransaction.mockRejectedValueOnce(new ServiceUnavailableException());
 */
export function getOzRelayerServiceMock(
  app: INestApplication,
): jest.Mocked<OzRelayerService> {
  return app.get(OzRelayerService);
}

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
      const statusHttpService = currentModuleFixture.select(StatusModule).get(HttpService, { strict: false });
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
export function getGaslessServiceMock(app: INestApplication): jest.Mocked<GaslessService> {
  return app.get(GaslessService) as jest.Mocked<GaslessService>;
}

/**
 * Reset all mocks between tests
 * Uses mockReset() to clear both call history AND queued implementations
 * @param app - Optional app instance to reset service spies
 */
export function resetMocks(app?: INestApplication): void {
  // Reset OzRelayerService mocks with fresh implementations
  defaultOzRelayerMock.sendTransaction.mockReset();
  defaultOzRelayerMock.getTransactionStatus.mockReset();
  defaultOzRelayerMock.getRelayerId.mockReset();

  // Use mockImplementation to generate unique transactionIds per call
  defaultOzRelayerMock.sendTransaction.mockImplementation(() =>
    Promise.resolve(createMockOzRelayerResponse())
  );
  defaultOzRelayerMock.getTransactionStatus.mockImplementation(() =>
    Promise.resolve(createMockConfirmedResponse())
  );
  defaultOzRelayerMock.getRelayerId.mockResolvedValue('test-relayer-id');

  // Reset GaslessService spy
  if (gaslessServiceSpy) {
    gaslessServiceSpy.mockReset();
    gaslessServiceSpy.mockResolvedValue('0');
  }

  // Reset HttpService spies for StatusModule
  if (app && currentModuleFixture) {
    // Reset StatusModule HttpService
    try {
      const statusHttpService = currentModuleFixture.select(StatusModule).get(HttpService, { strict: false });
      if (statusHttpService?.get) {
        (statusHttpService.get as unknown as jest.SpyInstance).mockReset();
        (statusHttpService.get as unknown as jest.SpyInstance).mockReturnValue(of({ data: {}, status: 200 }));
      }
    } catch {
      // StatusModule HttpService might not be available
    }

    // Reset root HttpService
    try {
      const rootHttpService = currentModuleFixture.get(HttpService, { strict: false });
      if (rootHttpService?.get) {
        (rootHttpService.get as unknown as jest.SpyInstance).mockReset();
        (rootHttpService.get as unknown as jest.SpyInstance).mockReturnValue(of({ data: {}, status: 200 }));
      }
    } catch {
      // Root HttpService might not be available
    }
  }
}
