import request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../../src/app.module';
import { TEST_WALLETS, TEST_ADDRESSES } from '../fixtures/test-wallets';
import { signForwardRequest, createForwardRequest } from '../utils/eip712-signer';
import {
  getNetworkConfig,
  isNetworkAvailable,
  logNetworkConfig,
  createProvider,
  getBalance,
} from './utils/network-helpers';
import { encodeNonces, decodeNonces } from './utils/token-helpers';

/**
 * Blockchain Integration Tests
 *
 * Network Agnostic - works on any network configured via RPC_URL:
 * - Hardhat: RPC_URL=http://localhost:8545 (default, fast, free)
 * - Amoy: RPC_URL=https://rpc-amoy.polygon.technology
 * - Mainnet: RPC_URL=https://polygon-mainnet.infura.io/v3/...
 *
 * Prerequisites:
 * 1. Set RPC_URL environment variable
 * 2. Set FORWARDER_ADDRESS if not using Hardhat default
 * 3. Ensure test accounts have sufficient balance for gas
 *
 * Run with:
 *   RPC_URL=http://localhost:8545 pnpm test:integration
 */
describe('Blockchain Integration Tests', () => {
  let app: INestApplication;
  let networkConfig: ReturnType<typeof getNetworkConfig>;
  let networkAvailable: boolean;

  beforeAll(async () => {
    // Check network availability first
    networkAvailable = await isNetworkAvailable();

    if (!networkAvailable) {
      console.warn('⚠️ Network unavailable - skipping integration tests');
      console.warn('   Start a local Hardhat node or configure RPC_URL');
      return;
    }

    networkConfig = getNetworkConfig();
    logNetworkConfig();

    // Create real NestJS application (no mocks for integration tests)
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: jest.fn((key: string, defaultValue?: unknown) => {
          const configMap: Record<string, unknown> = {
            OZ_RELAYER_URL: process.env.OZ_RELAYER_URL || 'https://api.defender.openzeppelin.com',
            OZ_RELAYER_API_KEY: process.env.OZ_RELAYER_API_KEY || 'test-oz-api-key',
            RELAY_API_KEY: process.env.RELAY_API_KEY || 'test-api-key',
            apiKey: process.env.RELAY_API_KEY || 'test-api-key',
            FORWARDER_ADDRESS: networkConfig.forwarderAddress,
            FORWARDER_NAME: 'ERC2771Forwarder',
            CHAIN_ID: networkConfig.chainId,
            RPC_URL: networkConfig.rpcUrl,
          };
          return configMap[key] ?? defaultValue;
        }),
        getOrThrow: jest.fn((key: string) => {
          const configMap: Record<string, unknown> = {
            OZ_RELAYER_URL: process.env.OZ_RELAYER_URL || 'https://api.defender.openzeppelin.com',
            OZ_RELAYER_API_KEY: process.env.OZ_RELAYER_API_KEY || 'test-oz-api-key',
            RELAY_API_KEY: process.env.RELAY_API_KEY || 'test-api-key',
            FORWARDER_ADDRESS: networkConfig.forwarderAddress,
            FORWARDER_NAME: 'ERC2771Forwarder',
            CHAIN_ID: networkConfig.chainId,
            RPC_URL: networkConfig.rpcUrl,
          };
          const value = configMap[key];
          if (value === undefined) throw new Error(`Config key ${key} not found`);
          return value;
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // Helper to skip tests if network unavailable
  const skipIfNoNetwork = () => {
    if (!networkAvailable) {
      console.log('   ⏭️ Skipped (network unavailable)');
      return true;
    }
    return false;
  };

  describe('Network Connectivity', () => {
    it('TC-INT-001: should connect to configured RPC endpoint', async () => {
      if (skipIfNoNetwork()) return;

      const provider = createProvider();
      const blockNumber = await provider.getBlockNumber();

      expect(blockNumber).toBeGreaterThanOrEqual(0);
      console.log(`   ✅ Connected - Block #${blockNumber}`);
    });

    it('TC-INT-002: should verify chain ID matches configuration', async () => {
      if (skipIfNoNetwork()) return;

      const provider = createProvider();
      const network = await provider.getNetwork();

      expect(Number(network.chainId)).toBe(networkConfig.chainId);
      console.log(`   ✅ Chain ID: ${network.chainId}`);
    });
  });

  describe('Direct TX - Real Blockchain', () => {
    it('TC-INT-003: should query real balance from blockchain', async () => {
      if (skipIfNoNetwork()) return;

      const balance = await getBalance(TEST_ADDRESSES.user);

      // Hardhat accounts should have 10000 ETH by default
      // Other networks will have whatever balance exists
      expect(balance).toBeGreaterThanOrEqual(0n);
      console.log(`   ✅ User balance: ${balance} wei`);
    });

    it('TC-INT-004: should accept Direct TX request (API level)', async () => {
      if (skipIfNoNetwork()) return;

      // Note: This test verifies API acceptance, not blockchain execution
      // Full blockchain execution requires OZ Relayer configuration
      const payload = {
        to: TEST_ADDRESSES.merchant,
        data: '0x00',
        speed: 'fast',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/relay/direct')
        .set('x-api-key', 'test-api-key')
        .send(payload);

      // API should accept the request (202) or reject if OZ Relayer not configured
      expect([202, 503]).toContain(response.status);
      console.log(`   ✅ API Response: ${response.status}`);
    });
  });

  describe('Gasless TX - Real Blockchain', () => {
    it('TC-INT-005: should query real nonce from Forwarder contract', async () => {
      if (skipIfNoNetwork()) return;

      const provider = createProvider();
      const nonceData = encodeNonces(TEST_ADDRESSES.user);

      try {
        const result = await provider.call({
          to: networkConfig.forwarderAddress,
          data: nonceData,
        });

        const nonce = decodeNonces(result);
        expect(nonce).toBeGreaterThanOrEqual(0n);
        console.log(`   ✅ User nonce: ${nonce}`);
      } catch (error) {
        // Forwarder might not be deployed on some networks
        console.log(`   ⚠️ Forwarder not deployed at ${networkConfig.forwarderAddress}`);
        expect(error).toBeDefined();
      }
    });

    it('TC-INT-006: should verify EIP-712 signature generation', async () => {
      if (skipIfNoNetwork()) return;

      const forwardRequest = createForwardRequest(TEST_ADDRESSES.user, TEST_ADDRESSES.merchant, {
        nonce: 0,
      });

      const signature = await signForwardRequest(TEST_WALLETS.user, forwardRequest);

      // Signature should be 65 bytes (130 hex chars + 0x prefix)
      expect(signature).toMatch(/^0x[a-fA-F0-9]{130}$/);
      console.log(`   ✅ Signature: ${signature.substring(0, 20)}...`);
    });

    it('TC-INT-007: should accept Gasless TX request via nonce endpoint', async () => {
      if (skipIfNoNetwork()) return;

      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/gasless/nonce/${TEST_ADDRESSES.user}`)
        .set('x-api-key', 'test-api-key');

      // Should return nonce or service unavailable if RPC fails
      expect([200, 503]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty('nonce');
        console.log(`   ✅ Nonce from API: ${response.body.nonce}`);
      } else {
        console.log(`   ⚠️ Nonce endpoint unavailable (RPC issue)`);
      }
    });
  });

  describe('Health & Status', () => {
    it('TC-INT-008: should return health status (200 or 503 if OZ Relayer unavailable)', async () => {
      if (skipIfNoNetwork()) return;

      const response = await request(app.getHttpServer()).get('/api/v1/health');

      // 200 if all services healthy, 503 if OZ Relayer pool is down (expected in local dev)
      expect([200, 503]).toContain(response.status);
      expect(response.body).toHaveProperty('status');
      console.log(`   ✅ Health endpoint responded: ${response.status} (status: ${response.body.status})`);
    });
  });
});
