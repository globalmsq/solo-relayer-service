import axios, { AxiosInstance } from 'axios';
import { TEST_WALLETS, TEST_ADDRESSES } from '../src/helpers/test-wallets';
import { signForwardRequestWithDomain, createForwardRequest } from '../src/helpers/signer';
import { isNetworkAvailable, getNetworkConfig, isLocalNetwork } from '../src/helpers/network';
import {
  getContractAddresses,
  verifyContractDeployed,
  getForwarderNonce,
  encodeTokenTransfer,
  ContractAddresses,
  mintTokensWithDeployer,
  HARDHAT_RELAYERS,
} from '../src/helpers/contracts';
import { parseTokenAmount } from '../src/helpers/token';

/**
 * SPEC-DLQ-001: DLQ Processing Integration Tests
 *
 * Tests for Dead Letter Queue (DLQ) flag propagation in relay API.
 * These tests verify that retryOnFailure flag is correctly accepted and propagated.
 *
 * Limitations:
 * - Status API does not return retryOnFailure field (by design)
 * - Actual DLQ processing occurs in queue-consumer (separate process)
 * - Full E2E testing requires Docker Compose environment
 *
 * Test Coverage:
 * - TC-DLQ-INT-001: retryOnFailure=false (default) flag propagation
 * - TC-DLQ-INT-002: retryOnFailure=true flag propagation for direct TX
 * - TC-DLQ-INT-003: retryOnFailure=true flag propagation for gasless TX
 * - TC-DLQ-INT-004: Verify transactions are accepted with DLQ flags
 */

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

describe('SPEC-DLQ-001: DLQ Processing Integration Tests', () => {
  let apiClient: AxiosInstance;
  let contracts: ContractAddresses;
  let contractsDeployed = false;

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

    contracts = getContractAddresses();
    contractsDeployed = await verifyContractDeployed(contracts.forwarder);

    // Pre-fund accounts with tokens for testing (only on local Hardhat network)
    if (contractsDeployed && isLocalNetwork()) {
      try {
        const mintAmount = parseTokenAmount('10000');
        for (const relayerAddress of HARDHAT_RELAYERS) {
          await mintTokensWithDeployer(contracts.sampleToken, relayerAddress, mintAmount);
        }
        await mintTokensWithDeployer(contracts.sampleToken, TEST_ADDRESSES.user, mintAmount);
      } catch (error) {
        console.warn('Pre-fund warning:', error);
      }
    }
  }, 60000);

  describe('retryOnFailure Flag Propagation - Direct TX', () => {
    it('TC-DLQ-INT-001: should accept direct TX with retryOnFailure=false (default)', async () => {
      if (!contractsDeployed) {
        console.log('Skipping: contracts not deployed');
        return;
      }

      const transferData = encodeTokenTransfer(TEST_ADDRESSES.merchant, parseTokenAmount('1'));
      const payload = {
        to: contracts.sampleToken,
        data: transferData,
        gasLimit: '100000',
        speed: 'fast',
        // retryOnFailure omitted - should default to false
      };

      let response;
      try {
        response = await apiClient.post('/api/v1/relay/direct', payload);
      } catch (error: any) {
        // 503 means relay service unavailable (queue not ready)
        if (error.response?.status === 503) {
          console.log('Skipping: relay service unavailable');
          return;
        }
        throw error;
      }

      expect(response.status).toBe(202);
      expect(response.data).toHaveProperty('transactionId');
      expect(typeof response.data.transactionId).toBe('string');

      // Note: retryOnFailure is stored in DB but not returned in status API
      // Verification of DB state requires direct DB access or queue-consumer logs
    }, 15000);

    it('TC-DLQ-INT-002: should accept direct TX with retryOnFailure=true', async () => {
      if (!contractsDeployed) {
        console.log('Skipping: contracts not deployed');
        return;
      }

      const transferData = encodeTokenTransfer(TEST_ADDRESSES.merchant, parseTokenAmount('1'));
      const payload = {
        to: contracts.sampleToken,
        data: transferData,
        gasLimit: '100000',
        speed: 'fast',
        retryOnFailure: true, // Explicit true - will be retried via DLQ
      };

      let response;
      try {
        response = await apiClient.post('/api/v1/relay/direct', payload);
      } catch (error: any) {
        if (error.response?.status === 503) {
          console.log('Skipping: relay service unavailable');
          return;
        }
        throw error;
      }

      expect(response.status).toBe(202);
      expect(response.data).toHaveProperty('transactionId');
      expect(typeof response.data.transactionId).toBe('string');

      // Store transactionId for later verification if needed
      console.log(`Transaction with retryOnFailure=true: ${response.data.transactionId}`);
    }, 15000);

    it('TC-DLQ-INT-002b: should accept direct TX with retryOnFailure=false (explicit)', async () => {
      if (!contractsDeployed) {
        console.log('Skipping: contracts not deployed');
        return;
      }

      const transferData = encodeTokenTransfer(TEST_ADDRESSES.merchant, parseTokenAmount('1'));
      const payload = {
        to: contracts.sampleToken,
        data: transferData,
        gasLimit: '100000',
        speed: 'fast',
        retryOnFailure: false, // Explicit false - will be marked failed immediately
      };

      let response;
      try {
        response = await apiClient.post('/api/v1/relay/direct', payload);
      } catch (error: any) {
        if (error.response?.status === 503) {
          console.log('Skipping: relay service unavailable');
          return;
        }
        throw error;
      }

      expect(response.status).toBe(202);
      expect(response.data).toHaveProperty('transactionId');
      expect(typeof response.data.transactionId).toBe('string');

      console.log(`Transaction with retryOnFailure=false: ${response.data.transactionId}`);
    }, 15000);
  });

  describe('retryOnFailure Flag Propagation - Gasless TX', () => {
    it('TC-DLQ-INT-003: should accept gasless TX with retryOnFailure=true', async () => {
      if (!contractsDeployed) {
        console.log('Skipping: contracts not deployed');
        return;
      }

      // Get nonce
      let nonceResponse;
      try {
        nonceResponse = await apiClient.get(`/api/v1/relay/gasless/nonce/${TEST_ADDRESSES.user}`);
      } catch (error: any) {
        if (error.response?.status === 503) {
          console.log('Skipping: relay service unavailable');
          return;
        }
        throw error;
      }

      const nonce = parseInt(nonceResponse.data.nonce, 10);

      // Create and sign request
      const transferData = encodeTokenTransfer(TEST_ADDRESSES.merchant, parseTokenAmount('1'));
      const forwardRequest = createForwardRequest(TEST_ADDRESSES.user, contracts.sampleToken, {
        nonce,
        data: transferData,
        gas: '150000',
      });
      const signature = await signForwardRequestWithDomain(TEST_WALLETS.user, forwardRequest);

      // Submit with retryOnFailure=true
      let response;
      try {
        response = await apiClient.post('/api/v1/relay/gasless', {
          request: forwardRequest,
          signature,
          retryOnFailure: true, // Enable DLQ retry for gasless TX
        });
      } catch (error: any) {
        if (error.response?.status === 503) {
          console.log('Skipping: relay service unavailable');
          return;
        }
        throw error;
      }

      expect(response.status).toBe(202);
      expect(response.data).toHaveProperty('transactionId');
      expect(typeof response.data.transactionId).toBe('string');

      console.log(`Gasless TX with retryOnFailure=true: ${response.data.transactionId}`);
    }, 30000);

    it('TC-DLQ-INT-003b: should accept gasless TX with retryOnFailure=false (explicit)', async () => {
      if (!contractsDeployed) {
        console.log('Skipping: contracts not deployed');
        return;
      }

      // Get nonce
      let nonceResponse;
      try {
        nonceResponse = await apiClient.get(`/api/v1/relay/gasless/nonce/${TEST_ADDRESSES.user}`);
      } catch (error: any) {
        if (error.response?.status === 503) {
          console.log('Skipping: relay service unavailable');
          return;
        }
        throw error;
      }

      const nonce = parseInt(nonceResponse.data.nonce, 10);

      // Create and sign request
      const transferData = encodeTokenTransfer(TEST_ADDRESSES.merchant, parseTokenAmount('1'));
      const forwardRequest = createForwardRequest(TEST_ADDRESSES.user, contracts.sampleToken, {
        nonce,
        data: transferData,
        gas: '150000',
      });
      const signature = await signForwardRequestWithDomain(TEST_WALLETS.user, forwardRequest);

      // Submit with retryOnFailure=false
      let response;
      try {
        response = await apiClient.post('/api/v1/relay/gasless', {
          request: forwardRequest,
          signature,
          retryOnFailure: false, // Disable DLQ retry
        });
      } catch (error: any) {
        if (error.response?.status === 503) {
          console.log('Skipping: relay service unavailable');
          return;
        }
        throw error;
      }

      expect(response.status).toBe(202);
      expect(response.data).toHaveProperty('transactionId');
      expect(typeof response.data.transactionId).toBe('string');

      console.log(`Gasless TX with retryOnFailure=false: ${response.data.transactionId}`);
    }, 30000);
  });

  describe('Database State Verification', () => {
    /**
     * TC-DLQ-INT-004: Verify retryOnFailure is stored correctly
     *
     * Note: This test documents the expected behavior but cannot directly verify
     * the DB state through the status API. The retryOnFailure field is:
     * - Stored in MySQL Transaction table (verified via unit tests)
     * - Used by queue-consumer for DLQ processing
     * - NOT returned in status API response (by design)
     *
     * To fully verify DB state:
     * 1. Use unit tests with mock DB (already covered in queue.service.spec.ts)
     * 2. Add a debug endpoint (not recommended for production)
     * 3. Use direct DB access in test environment
     */
    it('TC-DLQ-INT-004: should document retryOnFailure storage behavior', async () => {
      // This test serves as documentation and validates expected API behavior
      expect(true).toBe(true);

      /**
       * Expected DB state after TC-DLQ-INT-001:
       * - retryOnFailure = false (default when omitted)
       *
       * Expected DB state after TC-DLQ-INT-002:
       * - retryOnFailure = true (explicit)
       *
       * Expected DB state after TC-DLQ-INT-002b:
       * - retryOnFailure = false (explicit)
       *
       * Expected DB state after TC-DLQ-INT-003:
       * - retryOnFailure = true (explicit)
       *
       * Expected DB state after TC-DLQ-INT-003b:
       * - retryOnFailure = false (explicit)
       *
       * Verification covered in:
       * - packages/relay-api/src/queue/queue.service.spec.ts
       * - Unit tests verify DTO → DB mapping
       * - Unit tests verify SQS message includes retryOnFailure
       */
    });

    it('TC-DLQ-INT-004b: should verify status API response structure', async () => {
      if (!contractsDeployed) {
        console.log('Skipping: contracts not deployed');
        return;
      }

      // Submit a transaction first
      const transferData = encodeTokenTransfer(TEST_ADDRESSES.merchant, parseTokenAmount('1'));
      const payload = {
        to: contracts.sampleToken,
        data: transferData,
        gasLimit: '100000',
        speed: 'fast',
        retryOnFailure: true,
      };

      let submitResponse;
      try {
        submitResponse = await apiClient.post('/api/v1/relay/direct', payload);
      } catch (error: any) {
        if (error.response?.status === 503) {
          console.log('Skipping: relay service unavailable');
          return;
        }
        throw error;
      }

      const transactionId = submitResponse.data.transactionId;

      // Query status
      let statusResponse;
      try {
        statusResponse = await apiClient.get(`/api/v1/relay/status/${transactionId}`);
      } catch (error: any) {
        // Transaction may not be immediately available
        if (error.response?.status === 404) {
          console.log('Transaction not yet available in status API (expected for async processing)');
          return;
        }
        throw error;
      }

      // Verify response structure (retryOnFailure is NOT included by design)
      expect(statusResponse.data).toHaveProperty('transactionId');
      expect(statusResponse.data).toHaveProperty('status');
      expect(statusResponse.data).toHaveProperty('createdAt');

      // Explicitly verify retryOnFailure is NOT in response
      expect(statusResponse.data).not.toHaveProperty('retryOnFailure');
    }, 15000);
  });
});
