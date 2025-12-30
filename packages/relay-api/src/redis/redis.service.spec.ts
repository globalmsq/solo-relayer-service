import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';
import Redis from 'ioredis';

describe('RedisService', () => {
  let service: RedisService;
  let redisClient: Redis;

  beforeEach(async () => {
    // Mock Redis client
    redisClient = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      ping: jest.fn(),
      quit: jest.fn(),
    } as unknown as Redis;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: 'REDIS_CLIENT',
          useValue: redisClient,
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
  });

  afterEach(async () => {
    if (service) {
      await service.onModuleDestroy();
    }
  });

  describe('Service Definition', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have get method', () => {
      expect(service.get).toBeDefined();
      expect(typeof service.get).toBe('function');
    });

    it('should have set method', () => {
      expect(service.set).toBeDefined();
      expect(typeof service.set).toBe('function');
    });

    it('should have del method', () => {
      expect(service.del).toBeDefined();
      expect(typeof service.del).toBe('function');
    });

    it('should have healthCheck method', () => {
      expect(service.healthCheck).toBeDefined();
      expect(typeof service.healthCheck).toBe('function');
    });
  });

  describe('GET Operations', () => {
    it('should get a string value from Redis', async () => {
      const key = 'test-key';
      const value = 'test-value';
      jest.spyOn(redisClient, 'get').mockResolvedValue(value);

      const result = await service.get<string>(key);

      expect(redisClient.get).toHaveBeenCalledWith(key);
      expect(result).toBe(value);
    });

    it('should get a JSON object value from Redis', async () => {
      const key = 'test-object';
      const value = { id: 'tx-123', status: 'pending' };
      jest.spyOn(redisClient, 'get').mockResolvedValue(JSON.stringify(value));

      const result = await service.get<typeof value>(key);

      expect(redisClient.get).toHaveBeenCalledWith(key);
      expect(result).toEqual(value);
    });

    it('should return null when key does not exist', async () => {
      const key = 'non-existent-key';
      jest.spyOn(redisClient, 'get').mockResolvedValue(null);

      const result = await service.get<string>(key);

      expect(redisClient.get).toHaveBeenCalledWith(key);
      expect(result).toBeNull();
    });

    it('should handle malformed JSON gracefully', async () => {
      const key = 'bad-json-key';
      jest.spyOn(redisClient, 'get').mockResolvedValue('not valid json');

      // Should return the raw string if JSON parsing fails
      const result = await service.get<string>(key);

      expect(result).toBe('not valid json');
    });
  });

  describe('SET Operations', () => {
    it('should set a string value in Redis', async () => {
      const key = 'test-key';
      const value = 'test-value';
      jest.spyOn(redisClient, 'set').mockResolvedValue('OK');

      await service.set<string>(key, value);

      // Since the service keeps string values as-is
      expect(redisClient.set).toHaveBeenCalledWith(key, value);
    });

    it('should set a JSON object value in Redis', async () => {
      const key = 'test-object';
      const value = { id: 'tx-123', status: 'pending' };
      jest.spyOn(redisClient, 'set').mockResolvedValue('OK');

      await service.set<typeof value>(key, value);

      expect(redisClient.set).toHaveBeenCalledWith(key, JSON.stringify(value));
    });

    it('should set a value with TTL', async () => {
      const key = 'test-key-with-ttl';
      const value = 'test-value';
      const ttl = 600; // 10 minutes
      jest.spyOn(redisClient, 'set').mockResolvedValue('OK');

      await service.set<string>(key, value, ttl);

      expect(redisClient.set).toHaveBeenCalledWith(key, value, 'EX', ttl);
    });

    it('should set a JSON object with TTL', async () => {
      const key = 'tx-cache-key';
      const value = { id: 'tx-456', status: 'confirmed', hash: '0xabc123' };
      const ttl = 600;
      jest.spyOn(redisClient, 'set').mockResolvedValue('OK');

      await service.set<typeof value>(key, value, ttl);

      expect(redisClient.set).toHaveBeenCalledWith(
        key,
        JSON.stringify(value),
        'EX',
        ttl,
      );
    });

    it('should set a value without TTL', async () => {
      const key = 'persistent-key';
      const value = 'permanent-value';
      jest.spyOn(redisClient, 'set').mockResolvedValue('OK');

      await service.set<string>(key, value);

      expect(redisClient.set).toHaveBeenCalledWith(key, value);
    });
  });

  describe('DELETE Operations', () => {
    it('should delete an existing key', async () => {
      const key = 'test-key';
      jest.spyOn(redisClient, 'del').mockResolvedValue(1);

      const result = await service.del(key);

      expect(redisClient.del).toHaveBeenCalledWith(key);
      expect(result).toBe(1);
    });

    it('should return 0 when deleting non-existent key', async () => {
      const key = 'non-existent-key';
      jest.spyOn(redisClient, 'del').mockResolvedValue(0);

      const result = await service.del(key);

      expect(redisClient.del).toHaveBeenCalledWith(key);
      expect(result).toBe(0);
    });

    it('should delete multiple keys sequentially', async () => {
      const keys = ['key1', 'key2', 'key3'];
      jest.spyOn(redisClient, 'del').mockResolvedValue(1);

      // Delete each key individually
      for (const key of keys) {
        const result = await service.del(key);
        expect(result).toBeGreaterThanOrEqual(0);
      }

      expect(redisClient.del).toHaveBeenCalledTimes(keys.length);
    });
  });

  describe('Health Check', () => {
    it('should return true when Redis is healthy', async () => {
      jest.spyOn(redisClient, 'ping').mockResolvedValue('PONG');

      const result = await service.healthCheck();

      expect(redisClient.ping).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when Redis is not responding', async () => {
      jest.spyOn(redisClient, 'ping').mockRejectedValue(new Error('Connection failed'));

      const result = await service.healthCheck();

      expect(result).toBe(false);
    });

    it('should handle ping timeout gracefully', async () => {
      jest.spyOn(redisClient, 'ping').mockImplementation(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 1000),
          ),
      );

      const result = await service.healthCheck();

      expect(result).toBe(false);
    }, 10000);
  });

  describe('3-Tier Cache Integration', () => {
    it('should get transaction from Redis L1 cache', async () => {
      const txKey = 'tx:0xabc123';
      const txData = {
        id: 'tx-uuid-123',
        hash: '0xabc123',
        status: 'confirmed',
        value: '1000000000000000000',
      };
      jest.spyOn(redisClient, 'get').mockResolvedValue(JSON.stringify(txData));

      const result = await service.get<typeof txData>(txKey);

      expect(result).toEqual(txData);
    });

    it('should set transaction in Redis L1 with 10-minute TTL', async () => {
      const txKey = 'tx:0xdef456';
      const txData = {
        id: 'tx-uuid-456',
        hash: '0xdef456',
        status: 'pending',
        value: '2000000000000000000',
      };
      jest.spyOn(redisClient, 'set').mockResolvedValue('OK');

      await service.set<typeof txData>(txKey, txData, 600);

      expect(redisClient.set).toHaveBeenCalledWith(
        txKey,
        JSON.stringify(txData),
        'EX',
        600,
      );
    });

    it('should invalidate transaction cache on update', async () => {
      const txKey = 'tx:0xghi789';
      jest.spyOn(redisClient, 'del').mockResolvedValue(1);

      const result = await service.del(txKey);

      expect(redisClient.del).toHaveBeenCalledWith(txKey);
      expect(result).toBe(1);
    });

    it('should handle cache miss in L1 (returns null)', async () => {
      const txKey = 'tx:0xnotfound';
      jest.spyOn(redisClient, 'get').mockResolvedValue(null);

      const result = await service.get<any>(txKey);

      expect(result).toBeNull();
    });
  });

  describe('Module Lifecycle', () => {
    it('should disconnect from Redis on module destroy', async () => {
      jest.spyOn(redisClient, 'quit').mockResolvedValue('OK');

      await service.onModuleDestroy();

      expect(redisClient.quit).toHaveBeenCalled();
    });

    it('should handle disconnect errors gracefully', async () => {
      jest
        .spyOn(redisClient, 'quit')
        .mockRejectedValue(new Error('Already disconnected'));

      // Should not throw
      await service.onModuleDestroy();

      expect(redisClient.quit).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle Redis GET errors', async () => {
      jest
        .spyOn(redisClient, 'get')
        .mockRejectedValue(new Error('Redis connection error'));

      const key = 'test-key';

      await expect(service.get<string>(key)).rejects.toThrow('Redis connection error');
    });

    it('should handle Redis SET errors', async () => {
      jest
        .spyOn(redisClient, 'set')
        .mockRejectedValue(new Error('Redis memory exceeded'));

      const key = 'test-key';
      const value = 'test-value';

      await expect(service.set<string>(key, value)).rejects.toThrow(
        'Redis memory exceeded',
      );
    });

    it('should handle Redis DEL errors', async () => {
      jest
        .spyOn(redisClient, 'del')
        .mockRejectedValue(new Error('Redis cluster error'));

      const key = 'test-key';

      await expect(service.del(key)).rejects.toThrow('Redis cluster error');
    });
  });

  describe('Type Safety', () => {
    it('should preserve type information for generic objects', async () => {
      interface TransactionData {
        id: string;
        hash: string;
        status: 'pending' | 'confirmed' | 'failed';
        value: string;
      }

      const key = 'typed-tx';
      const value: TransactionData = {
        id: 'uuid-123',
        hash: '0xabc',
        status: 'confirmed',
        value: '1000',
      };

      jest.spyOn(redisClient, 'set').mockResolvedValue('OK');
      jest.spyOn(redisClient, 'get').mockResolvedValue(JSON.stringify(value));

      await service.set<TransactionData>(key, value);
      const result = await service.get<TransactionData>(key);

      expect(result).toEqual(value);
      expect(result!.status).toBe('confirmed');
    });
  });
});
