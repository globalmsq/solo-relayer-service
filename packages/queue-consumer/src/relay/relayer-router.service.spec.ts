import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RelayerRouterService } from './relayer-router.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('RelayerRouterService', () => {
  let service: RelayerRouterService;
  let configService: ConfigService;

  const mockRelayerUrls = [
    'http://oz-relayer-0:8080',
    'http://oz-relayer-1:8080',
    'http://oz-relayer-2:8080',
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RelayerRouterService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'relayer.urls') {
                return mockRelayerUrls.join(',');
              }
              if (key === 'relayer.url') {
                return 'http://oz-relayer-0:8080';
              }
              if (key === 'relayer.apiKey') {
                return 'test-api-key';
              }
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<RelayerRouterService>(RelayerRouterService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('initialization', () => {
    it('should parse comma-separated relayer URLs from config', () => {
      const urls = service.getRelayerUrls();
      expect(urls).toEqual(mockRelayerUrls);
      expect(urls).toHaveLength(3);
    });

    it('should use single URL as fallback when urls config is empty', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RelayerRouterService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'relayer.urls') return '';
                if (key === 'relayer.url') return 'http://single-relayer:8080';
                if (key === 'relayer.apiKey') return 'test-api-key';
                return undefined;
              }),
            },
          },
        ],
      }).compile();

      const singleUrlService = module.get<RelayerRouterService>(RelayerRouterService);
      expect(singleUrlService.getRelayerUrls()).toEqual(['http://single-relayer:8080']);
    });
  });

  describe('getAvailableRelayer - FR-001 Smart Routing', () => {
    it('should select the relayer with the lowest pending transactions', async () => {
      // Mock relayer responses with different pending TX counts
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('oz-relayer-0')) {
          return Promise.resolve({
            data: {
              data: [{ id: 'relayer-1-id', pending_transactions: 5, status: 'active' }],
            },
          });
        }
        if (url.includes('oz-relayer-1')) {
          return Promise.resolve({
            data: {
              data: [{ id: 'relayer-2-id', pending_transactions: 2, status: 'active' }], // Lowest
            },
          });
        }
        if (url.includes('oz-relayer-2')) {
          return Promise.resolve({
            data: {
              data: [{ id: 'relayer-3-id', pending_transactions: 8, status: 'active' }],
            },
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const result = await service.getAvailableRelayer();

      expect(result.url).toBe('http://oz-relayer-1:8080');
      expect(result.relayerId).toBe('relayer-2-id');
    });

    it('should select first relayer when all have equal pending transactions', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          data: [{ id: 'any-relayer-id', pending_transactions: 3, status: 'active' }],
        },
      });

      const result = await service.getAvailableRelayer();

      // Should select the first one (oz-relayer-0) when all are equal
      expect(result.url).toBe('http://oz-relayer-0:8080');
    });

    it('should skip unhealthy relayers (paused status)', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('oz-relayer-0')) {
          return Promise.resolve({
            data: {
              data: [{ id: 'relayer-1-id', pending_transactions: 1, status: 'paused' }], // Paused
            },
          });
        }
        if (url.includes('oz-relayer-1')) {
          return Promise.resolve({
            data: {
              data: [{ id: 'relayer-2-id', pending_transactions: 5, status: 'active' }],
            },
          });
        }
        if (url.includes('oz-relayer-2')) {
          return Promise.resolve({
            data: {
              data: [{ id: 'relayer-3-id', pending_transactions: 10, status: 'active' }],
            },
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const result = await service.getAvailableRelayer();

      // Should skip paused relayer-1, select relayer-2 (lower pending than relayer-3)
      expect(result.url).toBe('http://oz-relayer-1:8080');
      expect(result.relayerId).toBe('relayer-2-id');
    });

    it('should fall back to round-robin when all health checks fail', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Connection refused'));

      const result = await service.getAvailableRelayer();

      // Should use round-robin fallback with default relayer ID
      expect(result.url).toBe('http://oz-relayer-0:8080');
      expect(result.relayerId).toBe('default-relayer');
    });
  });

  describe('NFR-001 - Health Check Caching', () => {
    it('should use cached relayer info within TTL (10 seconds)', async () => {
      jest.useFakeTimers();

      mockedAxios.get.mockResolvedValue({
        data: {
          data: [{ id: 'cached-relayer-id', pending_transactions: 3, status: 'active' }],
        },
      });

      // First call - should make HTTP request
      await service.getAvailableRelayer();
      expect(mockedAxios.get).toHaveBeenCalledTimes(3); // All 3 relayers queried

      // Second call within TTL - should use cache
      await service.getAvailableRelayer();
      expect(mockedAxios.get).toHaveBeenCalledTimes(3); // No additional calls

      // Advance time beyond TTL (10 seconds)
      jest.advanceTimersByTime(11000);

      // Third call after TTL - should refresh cache
      await service.getAvailableRelayer();
      expect(mockedAxios.get).toHaveBeenCalledTimes(6); // 3 more calls
    });
  });

  describe('NFR-001 - Health Check Timeout', () => {
    it('should use 500ms timeout for health checks', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          data: [{ id: 'relayer-id', pending_transactions: 0, status: 'active' }],
        },
      });

      await service.getAvailableRelayer();

      // Verify timeout is set to 500ms
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          timeout: 500,
        }),
      );
    });
  });

  describe('round-robin fallback', () => {
    it('should cycle through relayers in round-robin fashion', async () => {
      // All health checks fail, triggering round-robin
      mockedAxios.get.mockRejectedValue(new Error('All relayers down'));

      // First call
      const result1 = await service.getAvailableRelayer();
      expect(result1.url).toBe('http://oz-relayer-0:8080');

      // Clear cache to force round-robin again
      service.invalidateCache('http://oz-relayer-0:8080');
      service.invalidateCache('http://oz-relayer-1:8080');
      service.invalidateCache('http://oz-relayer-2:8080');

      // Second call - should advance to next relayer
      const result2 = await service.getAvailableRelayer();
      expect(result2.url).toBe('http://oz-relayer-1:8080');

      // Clear cache again
      service.invalidateCache('http://oz-relayer-0:8080');
      service.invalidateCache('http://oz-relayer-1:8080');
      service.invalidateCache('http://oz-relayer-2:8080');

      // Third call
      const result3 = await service.getAvailableRelayer();
      expect(result3.url).toBe('http://oz-relayer-2:8080');

      // Clear cache again
      service.invalidateCache('http://oz-relayer-0:8080');
      service.invalidateCache('http://oz-relayer-1:8080');
      service.invalidateCache('http://oz-relayer-2:8080');

      // Fourth call - should wrap around to first
      const result4 = await service.getAvailableRelayer();
      expect(result4.url).toBe('http://oz-relayer-0:8080');
    });
  });

  describe('cache management', () => {
    it('should invalidate cache for specific relayer', async () => {
      jest.useFakeTimers();

      mockedAxios.get.mockResolvedValue({
        data: {
          data: [{ id: 'relayer-id', pending_transactions: 3, status: 'active' }],
        },
      });

      // First call - populates cache
      await service.getAvailableRelayer();
      expect(mockedAxios.get).toHaveBeenCalledTimes(3);

      // Invalidate cache for one relayer
      service.invalidateCache('http://oz-relayer-0:8080');

      // Second call - should only refresh the invalidated relayer
      await service.getAvailableRelayer();
      expect(mockedAxios.get).toHaveBeenCalledTimes(4); // Only 1 additional call
    });

    it('should return current cache state for monitoring', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          data: [{ id: 'relayer-id', pending_transactions: 3, status: 'active' }],
        },
      });

      await service.getAvailableRelayer();

      const cacheState = service.getCacheState();

      expect(cacheState.size).toBe(3);
      expect(cacheState.has('http://oz-relayer-0:8080')).toBe(true);
      expect(cacheState.has('http://oz-relayer-1:8080')).toBe(true);
      expect(cacheState.has('http://oz-relayer-2:8080')).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should mark relayer as unhealthy when API returns error', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('oz-relayer-0')) {
          return Promise.reject(new Error('Connection refused'));
        }
        return Promise.resolve({
          data: {
            data: [{ id: 'healthy-relayer-id', pending_transactions: 5, status: 'active' }],
          },
        });
      });

      const result = await service.getAvailableRelayer();

      // Should select healthy relayer, not the failed one
      expect(result.url).not.toBe('http://oz-relayer-0:8080');
    });

    it('should mark relayer as unhealthy when response has no relayer data', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('oz-relayer-0')) {
          return Promise.resolve({ data: { data: [] } }); // Empty response
        }
        return Promise.resolve({
          data: {
            data: [{ id: 'valid-relayer-id', pending_transactions: 5, status: 'active' }],
          },
        });
      });

      const result = await service.getAvailableRelayer();

      // Should select healthy relayer, not the one with empty response
      expect(result.url).not.toBe('http://oz-relayer-0:8080');
    });
  });

  describe('extractRelayerName utility', () => {
    it('should extract hostname from URL for logging', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          data: [{ id: 'relayer-id', pending_transactions: 0, status: 'active' }],
        },
      });

      // This is tested indirectly through logging behavior
      // The service should not throw when processing URLs
      await expect(service.getAvailableRelayer()).resolves.toBeDefined();
    });
  });
});
