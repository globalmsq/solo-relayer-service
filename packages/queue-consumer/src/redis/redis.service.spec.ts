import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

// Mock ioredis
jest.mock('ioredis', () => {
  const mockOn = jest.fn();
  const mockQuit = jest.fn().mockResolvedValue('OK');
  const mockPing = jest.fn().mockResolvedValue('PONG');
  const mockSmembers = jest.fn().mockResolvedValue(['oz-relayer-0', 'oz-relayer-1']);
  const mockScard = jest.fn().mockResolvedValue(2);

  return jest.fn().mockImplementation(() => ({
    on: mockOn,
    quit: mockQuit,
    ping: mockPing,
    smembers: mockSmembers,
    scard: mockScard,
    // Expose mocks for test access
    _mockOn: mockOn,
    _mockQuit: mockQuit,
    _mockPing: mockPing,
    _mockSmembers: mockSmembers,
    _mockScard: mockScard,
  }));
});

describe('RedisService', () => {
  let service: RedisService;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'redis.url') {
        return 'redis://localhost:6379';
      }
      return undefined;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(async () => {
    // Clean up
    if (service) {
      await service.onModuleDestroy();
    }
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should read Redis URL from config', async () => {
      await service.onModuleInit();
      expect(mockConfigService.get).toHaveBeenCalledWith('redis.url');
    });
  });

  describe('isAvailable', () => {
    it('should return false before initialization', () => {
      expect(service.isAvailable()).toBe(false);
    });

    it('should return true after successful initialization', async () => {
      await service.onModuleInit();
      expect(service.isAvailable()).toBe(true);
    });
  });

  describe('smembers', () => {
    it('should return empty array when not connected', async () => {
      const result = await service.smembers('relayer:active');
      expect(result).toEqual([]);
    });

    it('should call Redis smembers when connected', async () => {
      await service.onModuleInit();
      const result = await service.smembers('relayer:active');
      expect(result).toEqual(['oz-relayer-0', 'oz-relayer-1']);
    });
  });

  describe('scard', () => {
    it('should return 0 when not connected', async () => {
      const result = await service.scard('relayer:active');
      expect(result).toBe(0);
    });

    it('should call Redis scard when connected', async () => {
      await service.onModuleInit();
      const result = await service.scard('relayer:active');
      expect(result).toBe(2);
    });
  });

  describe('ping', () => {
    it('should return false when not connected', async () => {
      const result = await service.ping();
      expect(result).toBe(false);
    });

    it('should return true when connected', async () => {
      await service.onModuleInit();
      const result = await service.ping();
      expect(result).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should close connection on module destroy', async () => {
      await service.onModuleInit();
      await service.onModuleDestroy();
      expect(service.isAvailable()).toBe(false);
    });
  });
});
