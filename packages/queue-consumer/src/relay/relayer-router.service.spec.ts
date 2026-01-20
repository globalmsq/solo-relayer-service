import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RelayerRouterService } from './relayer-router.service';
import { RedisService } from '../redis/redis.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('RelayerRouterService', () => {
  let service: RelayerRouterService;
  let configService: ConfigService;
  let redisService: RedisService;

  const mockRelayerUrls = [
    'http://oz-relayer-0:8080',
    'http://oz-relayer-1:8080',
    'http://oz-relayer-2:8080',
  ];

  // SPEC-DISCOVERY-001: Mock Redis active relayers
  const mockActiveRelayers = ['oz-relayer-0', 'oz-relayer-1', 'oz-relayer-2'];

  // Mock RedisService
  const mockRedisService = {
    smembers: jest.fn().mockResolvedValue(mockActiveRelayers),
    scard: jest.fn().mockResolvedValue(3),
    isAvailable: jest.fn().mockReturnValue(true),
    ping: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    // Reset mock implementations
    mockRedisService.smembers.mockResolvedValue(mockActiveRelayers);
    mockRedisService.isAvailable.mockReturnValue(true);

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
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    service = module.get<RelayerRouterService>(RelayerRouterService);
    configService = module.get<ConfigService>(ConfigService);
    redisService = module.get<RedisService>(RedisService);
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
          {
            provide: RedisService,
            useValue: mockRedisService,
          },
        ],
      }).compile();

      const singleUrlService = module.get<RelayerRouterService>(RelayerRouterService);
      // Initial state uses fallback URLs before Redis is queried
      expect(singleUrlService.getFallbackRelayerUrls()).toEqual(['http://single-relayer:8080']);
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

  describe('SPEC-DISCOVERY-001 Phase 2 - Redis Integration', () => {
    it('should query Redis for active relayers on getAvailableRelayer call', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          data: [{ id: 'relayer-id', pending_transactions: 0, status: 'active' }],
        },
      });

      await service.getAvailableRelayer();

      // Verify Redis smembers was called with correct key
      expect(mockRedisService.smembers).toHaveBeenCalledWith('relayer:active');
    });

    it('should construct URLs from Redis hostnames', async () => {
      // Redis returns hostnames like 'oz-relayer-0'
      mockRedisService.smembers.mockResolvedValue(['oz-relayer-0', 'oz-relayer-1']);

      mockedAxios.get.mockResolvedValue({
        data: {
          data: [{ id: 'relayer-id', pending_transactions: 0, status: 'active' }],
        },
      });

      await service.getAvailableRelayer();

      // Verify URLs are constructed with port 8080
      const urls = service.getRelayerUrls();
      expect(urls).toContain('http://oz-relayer-0:8080');
      expect(urls).toContain('http://oz-relayer-1:8080');
    });

    it('should fall back to environment config when Redis returns empty set', async () => {
      // Redis returns empty set (no active relayers)
      mockRedisService.smembers.mockResolvedValue([]);

      mockedAxios.get.mockResolvedValue({
        data: {
          data: [{ id: 'relayer-id', pending_transactions: 0, status: 'active' }],
        },
      });

      await service.getAvailableRelayer();

      // Should use fallback URLs from config
      const urls = service.getRelayerUrls();
      expect(urls).toEqual(mockRelayerUrls);
    });

    it('should fall back to environment config when Redis throws error', async () => {
      // Redis throws error
      mockRedisService.smembers.mockRejectedValue(new Error('Redis connection failed'));

      mockedAxios.get.mockResolvedValue({
        data: {
          data: [{ id: 'relayer-id', pending_transactions: 0, status: 'active' }],
        },
      });

      await service.getAvailableRelayer();

      // Should use fallback URLs from config
      const urls = service.getRelayerUrls();
      expect(urls).toEqual(mockRelayerUrls);
    });

    it('should sort relayer hostnames from Redis for consistent ordering', async () => {
      // Redis returns unsorted hostnames
      mockRedisService.smembers.mockResolvedValue(['oz-relayer-2', 'oz-relayer-0', 'oz-relayer-1']);

      mockedAxios.get.mockResolvedValue({
        data: {
          data: [{ id: 'relayer-id', pending_transactions: 0, status: 'active' }],
        },
      });

      await service.getAvailableRelayer();

      // Verify URLs are sorted
      const urls = service.getRelayerUrls();
      expect(urls).toEqual([
        'http://oz-relayer-0:8080',
        'http://oz-relayer-1:8080',
        'http://oz-relayer-2:8080',
      ]);
    });

    it('should expose Redis discovery status', () => {
      mockRedisService.isAvailable.mockReturnValue(true);
      expect(service.isUsingRedisDiscovery()).toBe(true);

      mockRedisService.isAvailable.mockReturnValue(false);
      expect(service.isUsingRedisDiscovery()).toBe(false);
    });

    it('should expose fallback URLs from config', () => {
      const fallbackUrls = service.getFallbackRelayerUrls();
      expect(fallbackUrls).toEqual(mockRelayerUrls);
    });
  });

  describe('SPEC-DISCOVERY-001 Phase 2 - Redis SMEMBERS Caching', () => {
    it('should use cached active relayers within 2-second TTL', async () => {
      jest.useFakeTimers();

      mockedAxios.get.mockResolvedValue({
        data: {
          data: [{ id: 'relayer-id', pending_transactions: 0, status: 'active' }],
        },
      });

      // First call - should query Redis
      await service.getAvailableRelayer();
      expect(mockRedisService.smembers).toHaveBeenCalledTimes(1);

      // Second call within TTL - should use cache
      await service.getAvailableRelayer();
      expect(mockRedisService.smembers).toHaveBeenCalledTimes(1); // No additional call

      // Third call still within TTL
      jest.advanceTimersByTime(1000); // 1 second
      await service.getAvailableRelayer();
      expect(mockRedisService.smembers).toHaveBeenCalledTimes(1); // Still cached
    });

    it('should refresh Redis after 2-second TTL expires', async () => {
      jest.useFakeTimers();

      mockedAxios.get.mockResolvedValue({
        data: {
          data: [{ id: 'relayer-id', pending_transactions: 0, status: 'active' }],
        },
      });

      // First call - should query Redis
      await service.getAvailableRelayer();
      expect(mockRedisService.smembers).toHaveBeenCalledTimes(1);

      // Advance time beyond 2-second TTL
      jest.advanceTimersByTime(2100);

      // Next call after TTL - should query Redis again
      await service.getAvailableRelayer();
      expect(mockRedisService.smembers).toHaveBeenCalledTimes(2);
    });

    it('should bypass cache when URL list is empty', async () => {
      // Clear URLs by making Redis return empty first
      mockRedisService.smembers.mockResolvedValueOnce([]);

      mockedAxios.get.mockResolvedValue({
        data: {
          data: [{ id: 'relayer-id', pending_transactions: 0, status: 'active' }],
        },
      });

      // First call - falls back to config URLs since Redis returns empty
      await service.getAvailableRelayer();
      expect(mockRedisService.smembers).toHaveBeenCalledTimes(1);

      // Reset mock for next call
      mockRedisService.smembers.mockResolvedValue(mockActiveRelayers);

      // Second call - should still query Redis since fallback was used
      // (cache doesn't prevent query when we got empty from Redis)
      await service.getAvailableRelayer();
      expect(mockRedisService.smembers).toHaveBeenCalledTimes(2);
    });

    it('should reduce Redis calls significantly at high TPS', async () => {
      jest.useFakeTimers();

      mockedAxios.get.mockResolvedValue({
        data: {
          data: [{ id: 'relayer-id', pending_transactions: 0, status: 'active' }],
        },
      });

      // Simulate 100 calls within 2 seconds (50 TPS equivalent)
      for (let i = 0; i < 100; i++) {
        await service.getAvailableRelayer();
        jest.advanceTimersByTime(20); // 20ms per call = 50 TPS
      }

      // With 2-second cache, should only have ~1 Redis call
      // (first call triggers, rest are cached)
      expect(mockRedisService.smembers).toHaveBeenCalledTimes(1);
    });
  });
});
