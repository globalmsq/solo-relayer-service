import discoveryConfig from "./discovery.config";

describe("discoveryConfig", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("relayerCount configuration", () => {
    it("should use default value 3 when RELAYER_COUNT is not set", () => {
      delete process.env.RELAYER_COUNT;

      const config = discoveryConfig();
      expect(config.relayerCount).toBe(3);
    });

    it("should parse RELAYER_COUNT from environment", () => {
      process.env.RELAYER_COUNT = "5";

      const config = discoveryConfig();
      expect(config.relayerCount).toBe(5);
    });

    it("should validate RELAYER_COUNT is within range 1-10", () => {
      process.env.RELAYER_COUNT = "0";
      expect(() => discoveryConfig()).toThrow(
        "RELAYER_COUNT must be between 1 and 10",
      );

      process.env.RELAYER_COUNT = "11";
      expect(() => discoveryConfig()).toThrow(
        "RELAYER_COUNT must be between 1 and 10",
      );
    });

    it("should accept valid RELAYER_COUNT values", () => {
      process.env.RELAYER_COUNT = "1";
      expect(discoveryConfig().relayerCount).toBe(1);

      process.env.RELAYER_COUNT = "10";
      expect(discoveryConfig().relayerCount).toBe(10);
    });
  });

  describe("relayerPort configuration", () => {
    it("should use default value 8080 when RELAYER_PORT is not set", () => {
      delete process.env.RELAYER_PORT;

      const config = discoveryConfig();
      expect(config.relayerPort).toBe(8080);
    });

    it("should parse RELAYER_PORT from environment", () => {
      process.env.RELAYER_PORT = "3000";

      const config = discoveryConfig();
      expect(config.relayerPort).toBe(3000);
    });

    it("should validate RELAYER_PORT is within range 1-65535", () => {
      process.env.RELAYER_PORT = "0";
      expect(() => discoveryConfig()).toThrow(
        "RELAYER_PORT must be between 1 and 65535",
      );

      process.env.RELAYER_PORT = "65536";
      expect(() => discoveryConfig()).toThrow(
        "RELAYER_PORT must be between 1 and 65535",
      );
    });

    it("should accept valid RELAYER_PORT values", () => {
      process.env.RELAYER_PORT = "1";
      expect(discoveryConfig().relayerPort).toBe(1);

      process.env.RELAYER_PORT = "65535";
      expect(discoveryConfig().relayerPort).toBe(65535);
    });
  });

  describe("relayerApiKey configuration", () => {
    it("should use empty string when OZ_RELAYER_API_KEY is not set", () => {
      delete process.env.OZ_RELAYER_API_KEY;

      const config = discoveryConfig();
      expect(config.relayerApiKey).toBe("");
    });

    it("should parse OZ_RELAYER_API_KEY from environment", () => {
      process.env.OZ_RELAYER_API_KEY = "test-api-key";

      const config = discoveryConfig();
      expect(config.relayerApiKey).toBe("test-api-key");
    });
  });

  describe("healthCheckInterval configuration", () => {
    it("should use default value 10000 when HEALTH_CHECK_INTERVAL_MS is not set", () => {
      delete process.env.HEALTH_CHECK_INTERVAL_MS;

      const config = discoveryConfig();
      expect(config.healthCheckInterval).toBe(10000);
    });

    it("should parse HEALTH_CHECK_INTERVAL_MS from environment", () => {
      process.env.HEALTH_CHECK_INTERVAL_MS = "5000";

      const config = discoveryConfig();
      expect(config.healthCheckInterval).toBe(5000);
    });

    it("should validate HEALTH_CHECK_INTERVAL_MS is within range 1000-60000", () => {
      process.env.HEALTH_CHECK_INTERVAL_MS = "999";
      expect(() => discoveryConfig()).toThrow(
        "HEALTH_CHECK_INTERVAL_MS must be between 1000 and 60000",
      );

      process.env.HEALTH_CHECK_INTERVAL_MS = "60001";
      expect(() => discoveryConfig()).toThrow(
        "HEALTH_CHECK_INTERVAL_MS must be between 1000 and 60000",
      );
    });

    it("should accept valid HEALTH_CHECK_INTERVAL_MS values", () => {
      process.env.HEALTH_CHECK_INTERVAL_MS = "1000";
      expect(discoveryConfig().healthCheckInterval).toBe(1000);

      process.env.HEALTH_CHECK_INTERVAL_MS = "60000";
      expect(discoveryConfig().healthCheckInterval).toBe(60000);
    });
  });

  describe("healthCheckTimeout configuration", () => {
    it("should use default value 500 when HEALTH_CHECK_TIMEOUT_MS is not set", () => {
      delete process.env.HEALTH_CHECK_TIMEOUT_MS;

      const config = discoveryConfig();
      expect(config.healthCheckTimeout).toBe(500);
    });

    it("should parse HEALTH_CHECK_TIMEOUT_MS from environment", () => {
      process.env.HEALTH_CHECK_TIMEOUT_MS = "1000";

      const config = discoveryConfig();
      expect(config.healthCheckTimeout).toBe(1000);
    });

    it("should validate HEALTH_CHECK_TIMEOUT_MS is within range 100-5000", () => {
      process.env.HEALTH_CHECK_TIMEOUT_MS = "99";
      expect(() => discoveryConfig()).toThrow(
        "HEALTH_CHECK_TIMEOUT_MS must be between 100 and 5000",
      );

      process.env.HEALTH_CHECK_TIMEOUT_MS = "5001";
      expect(() => discoveryConfig()).toThrow(
        "HEALTH_CHECK_TIMEOUT_MS must be between 100 and 5000",
      );
    });

    it("should accept valid HEALTH_CHECK_TIMEOUT_MS values", () => {
      process.env.HEALTH_CHECK_TIMEOUT_MS = "100";
      expect(discoveryConfig().healthCheckTimeout).toBe(100);

      process.env.HEALTH_CHECK_TIMEOUT_MS = "5000";
      expect(discoveryConfig().healthCheckTimeout).toBe(5000);
    });
  });

  describe("redis configuration", () => {
    it("should use default Redis host localhost", () => {
      delete process.env.REDIS_HOST;

      const config = discoveryConfig();
      expect(config.redis.host).toBe("localhost");
    });

    it("should use default Redis port 6379", () => {
      delete process.env.REDIS_PORT;

      const config = discoveryConfig();
      expect(config.redis.port).toBe(6379);
    });

    it("should parse REDIS_HOST from environment", () => {
      process.env.REDIS_HOST = "redis-server";

      const config = discoveryConfig();
      expect(config.redis.host).toBe("redis-server");
    });

    it("should parse REDIS_PORT from environment", () => {
      process.env.REDIS_PORT = "6380";

      const config = discoveryConfig();
      expect(config.redis.port).toBe(6380);
    });
  });

  describe("complete configuration", () => {
    it("should return complete valid configuration", () => {
      process.env.RELAYER_COUNT = "3";
      process.env.RELAYER_PORT = "8080";
      process.env.OZ_RELAYER_API_KEY = "test-api-key";
      process.env.HEALTH_CHECK_INTERVAL_MS = "10000";
      process.env.HEALTH_CHECK_TIMEOUT_MS = "500";
      process.env.REDIS_HOST = "localhost";
      process.env.REDIS_PORT = "6379";

      const config = discoveryConfig();

      expect(config).toEqual({
        relayerCount: 3,
        relayerPort: 8080,
        relayerDnsSuffix: "",
        relayerApiKey: "test-api-key",
        healthCheckInterval: 10000,
        healthCheckTimeout: 500,
        redis: {
          host: "localhost",
          port: 6379,
        },
      });
    });
  });
});
