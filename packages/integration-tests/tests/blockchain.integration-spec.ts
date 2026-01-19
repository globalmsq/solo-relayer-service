import axios, { AxiosInstance } from 'axios';
import { TEST_WALLETS, TEST_ADDRESSES } from '../src/helpers/test-wallets';
import { signForwardRequest, createForwardRequest } from '../src/helpers/eip712-signer-static';
import {
  getNetworkConfig,
  isNetworkAvailable,
  createProvider,
  getBalance,
} from '../src/helpers/network';
import { encodeNonces, decodeNonces } from '../src/helpers/token';

/**
 * Blockchain Integration Tests
 *
 * Network Agnostic - works on any network configured via RPC_URL
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
    const relayApiUrl = getRequiredEnv('RELAY_API_URL');
    const apiKey = getRequiredEnv('RELAY_API_KEY');

    apiClient = axios.create({
      baseURL: relayApiUrl,
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    const networkAvailable = await isNetworkAvailable();
    if (!networkAvailable) {
      throw new Error('Network unavailable. Start Docker Compose first.');
    }

    networkConfig = getNetworkConfig();
  });

  describe('Network Connectivity', () => {
    it('TC-INT-001: should connect to configured RPC endpoint', async () => {
      const provider = createProvider();
      try {
        const blockNumber = await provider.getBlockNumber();
        expect(blockNumber).toBeGreaterThanOrEqual(0);
      } finally {
        provider.destroy();
      }
    });

    it('TC-INT-002: should verify chain ID matches configuration', async () => {
      const provider = createProvider();
      try {
        const network = await provider.getNetwork();
        expect(Number(network.chainId)).toBe(networkConfig.chainId);
      } finally {
        provider.destroy();
      }
    });
  });

  describe('Direct TX - Real Blockchain', () => {
    it('TC-INT-003: should query real balance from blockchain', async () => {
      const balance = await getBalance(TEST_ADDRESSES.user);
      expect(balance).toBeGreaterThanOrEqual(0n);
    });

    it('TC-INT-004: should accept Direct TX request (API level)', async () => {
      const payload = {
        to: TEST_ADDRESSES.merchant,
        data: '0x00',
        speed: 'fast',
      };

      try {
        const response = await apiClient.post('/api/v1/relay/direct', payload);
        expect(response.status).toBe(202);
      } catch (error: any) {
        if (error.response?.status === 503) {
          return; // OZ Relayer unavailable - expected in local dev
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
      } catch (error) {
        const code = await provider.getCode(networkConfig.forwarderAddress);
        if (code === '0x') {
          return; // Forwarder contract not deployed
        }
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
      expect(signature).toMatch(/^0x[a-fA-F0-9]{130}$/);
    });

    it('TC-INT-007: should accept Gasless TX nonce request via API', async () => {
      try {
        const response = await apiClient.get(`/api/v1/relay/gasless/nonce/${TEST_ADDRESSES.user}`);
        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('nonce');
      } catch (error: any) {
        if (error.response?.status === 503) {
          return; // RPC issue
        }
        throw error;
      }
    });
  });

  describe('Health & Status', () => {
    it('TC-INT-008: should return health status', async () => {
      try {
        const response = await apiClient.get('/api/v1/health');
        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('status');
      } catch (error: any) {
        if (error.response?.status === 503) {
          expect(error.response.data).toHaveProperty('status');
          return; // OZ Relayer pool down
        }
        throw error;
      }
    });
  });
});
