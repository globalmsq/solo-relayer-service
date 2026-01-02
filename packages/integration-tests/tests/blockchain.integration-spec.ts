import axios, { AxiosInstance } from 'axios';
import { TEST_WALLETS, TEST_ADDRESSES } from '../src/helpers/test-wallets';
import { signForwardRequest, createForwardRequest } from '../src/helpers/eip712-signer-static';
import {
  getNetworkConfig,
  isNetworkAvailable,
  logNetworkConfig,
  createProvider,
  getBalance,
} from '../src/helpers/network';
import { encodeNonces, decodeNonces } from '../src/helpers/token';

/**
 * Blockchain Integration Tests
 *
 * Network Agnostic - works on any network configured via RPC_URL:
 * - Hardhat: RPC_URL=http://localhost:8545 (default, fast, free)
 * - Amoy: RPC_URL=https://rpc-amoy.polygon.technology
 * - Mainnet: RPC_URL=https://polygon-mainnet.infura.io/v3/...
 *
 * Prerequisites:
 * 1. Docker Compose stack running (hardhat-node, redis, oz-relayer, relay-api)
 * 2. Environment variables configured:
 *    - RPC_URL: Blockchain RPC endpoint
 *    - CHAIN_ID: Blockchain chain ID
 *    - FORWARDER_ADDRESS: Deployed forwarder contract address
 *    - RELAY_API_URL: URL of the running relay-api service
 *    - RELAY_API_KEY: API key for authentication
 *
 * Run with:
 *   docker compose run --rm integration-tests
 */

/**
 * Get required environment variable or throw error
 */
function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

describe('Blockchain Integration Tests', () => {
  let apiClient: AxiosInstance;
  let networkConfig: ReturnType<typeof getNetworkConfig>;

  beforeAll(async () => {
    // Validate required environment variables
    const relayApiUrl = getRequiredEnv('RELAY_API_URL');
    const apiKey = getRequiredEnv('RELAY_API_KEY');

    // Create axios client for relay-api
    apiClient = axios.create({
      baseURL: relayApiUrl,
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    // Check network availability - fail fast if not available
    const networkAvailable = await isNetworkAvailable();

    if (!networkAvailable) {
      throw new Error(
        'Network unavailable. Integration tests require a running blockchain node.\n' +
          'Start Docker Compose: cd docker && docker compose up\n' +
          'Or configure RPC_URL environment variable.',
      );
    }

    networkConfig = getNetworkConfig();
    logNetworkConfig();
    console.log(`   RELAY_API_URL: ${relayApiUrl}`);
  });

  describe('Network Connectivity', () => {
    it('TC-INT-001: should connect to configured RPC endpoint', async () => {
      const provider = createProvider();
      try {
        const blockNumber = await provider.getBlockNumber();

        expect(blockNumber).toBeGreaterThanOrEqual(0);
        console.log(`   ✅ Connected - Block #${blockNumber}`);
      } finally {
        provider.destroy();
      }
    });

    it('TC-INT-002: should verify chain ID matches configuration', async () => {
      const provider = createProvider();
      try {
        const network = await provider.getNetwork();

        expect(Number(network.chainId)).toBe(networkConfig.chainId);
        console.log(`   ✅ Chain ID: ${network.chainId}`);
      } finally {
        provider.destroy();
      }
    });
  });

  describe('Direct TX - Real Blockchain', () => {
    it('TC-INT-003: should query real balance from blockchain', async () => {
      const balance = await getBalance(TEST_ADDRESSES.user);

      // Hardhat accounts should have 10000 ETH by default
      // Other networks will have whatever balance exists
      expect(balance).toBeGreaterThanOrEqual(0n);
      console.log(`   ✅ User balance: ${balance} wei`);
    });

    it('TC-INT-004: should accept Direct TX request (API level)', async () => {
      // Note: This test verifies API acceptance, not blockchain execution
      // Full blockchain execution requires OZ Relayer configuration
      const payload = {
        to: TEST_ADDRESSES.merchant,
        data: '0x00',
        speed: 'fast',
      };

      let response;
      try {
        response = await apiClient.post('/api/v1/relay/direct', payload);
        // API accepted the request (202)
        expect(response.status).toBe(202);
        console.log(`   ✅ API Response: ${response.status}`);
      } catch (error: any) {
        // API rejected if OZ Relayer not configured (503)
        if (error.response?.status === 503) {
          console.log(`   ✅ API Response: 503 (OZ Relayer unavailable - expected in local dev)`);
          return;
        }
        throw error;
      }
    });
  });

  describe('Gasless TX - Real Blockchain', () => {
    it('TC-INT-005: should query real nonce from Forwarder contract', async () => {
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
        // Check if contract exists at the address
        const code = await provider.getCode(networkConfig.forwarderAddress);
        if (code === '0x') {
          // Forwarder contract not deployed - gracefully skip
          console.warn(`   ⚠️ Skipping: Forwarder contract not found at ${networkConfig.forwarderAddress}`);
          return;
        }
        // Contract exists but call failed - re-throw to fail the test
        throw error;
      } finally {
        provider.destroy();
      }
    });

    it('TC-INT-006: should verify EIP-712 signature generation', async () => {
      const forwardRequest = createForwardRequest(TEST_ADDRESSES.user, TEST_ADDRESSES.merchant, {
        nonce: 0,
      });

      const signature = await signForwardRequest(TEST_WALLETS.user, forwardRequest);

      // Signature should be 65 bytes (130 hex chars + 0x prefix)
      expect(signature).toMatch(/^0x[a-fA-F0-9]{130}$/);
      console.log(`   ✅ Signature: ${signature.substring(0, 20)}...`);
    });

    it('TC-INT-007: should accept Gasless TX nonce request via API', async () => {
      let response;
      try {
        response = await apiClient.get(`/api/v1/relay/gasless/nonce/${TEST_ADDRESSES.user}`);
        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('nonce');
        console.log(`   ✅ Nonce from API: ${response.data.nonce}`);
      } catch (error: any) {
        // Service unavailable if RPC fails
        if (error.response?.status === 503) {
          console.log(`   ⚠️ Nonce endpoint unavailable (RPC issue)`);
          return;
        }
        throw error;
      }
    });
  });

  describe('Health & Status', () => {
    it('TC-INT-008: should return health status (200 or 503 if OZ Relayer unavailable)', async () => {
      let response;
      try {
        response = await apiClient.get('/api/v1/health');
        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('status');
        console.log(`   ✅ Health endpoint responded: ${response.status} (status: ${response.data.status})`);
      } catch (error: any) {
        // 503 if OZ Relayer pool is down (expected in local dev)
        if (error.response?.status === 503) {
          expect(error.response.data).toHaveProperty('status');
          console.log(`   ✅ Health endpoint responded: 503 (status: ${error.response.data.status})`);
          return;
        }
        throw error;
      }
    });
  });
});
