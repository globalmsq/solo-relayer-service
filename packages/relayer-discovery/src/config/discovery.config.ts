import { registerAs } from "@nestjs/config";

export interface DiscoveryConfig {
  relayerCount: number;
  relayerPort: number;
  relayerDnsSuffix: string;
  relayerApiKey: string;
  healthCheckInterval: number;
  healthCheckTimeout: number;
  redis: {
    host: string;
    port: number;
  };
}

function validateRange(
  value: number,
  min: number,
  max: number,
  name: string,
): void {
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
}

export default registerAs("discovery", (): DiscoveryConfig => {
  const relayerCount = parseInt(process.env.RELAYER_COUNT || "3", 10);
  const relayerPort = parseInt(process.env.RELAYER_PORT || "8080", 10);
  const relayerDnsSuffix = process.env.RELAYER_DNS_SUFFIX || "";
  const relayerApiKey = process.env.OZ_RELAYER_API_KEY || "";
  const healthCheckInterval = parseInt(
    process.env.HEALTH_CHECK_INTERVAL_MS || "10000",
    10,
  );
  const healthCheckTimeout = parseInt(
    process.env.HEALTH_CHECK_TIMEOUT_MS || "500",
    10,
  );

  // Validation
  validateRange(relayerCount, 1, 10, "RELAYER_COUNT");
  validateRange(relayerPort, 1, 65535, "RELAYER_PORT");
  validateRange(healthCheckInterval, 1000, 60000, "HEALTH_CHECK_INTERVAL_MS");
  validateRange(healthCheckTimeout, 100, 5000, "HEALTH_CHECK_TIMEOUT_MS");

  return {
    relayerCount,
    relayerPort,
    relayerDnsSuffix,
    relayerApiKey,
    healthCheckInterval,
    healthCheckTimeout,
    redis: {
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
    },
  };
});
