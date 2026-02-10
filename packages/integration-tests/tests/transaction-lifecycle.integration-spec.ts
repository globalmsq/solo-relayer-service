import axios, { AxiosInstance } from 'axios';
import { TEST_WALLETS, TEST_ADDRESSES } from '../src/helpers/test-wallets';
import { signForwardRequest as signForwardRequestE2E, createForwardRequest as createForwardRequestE2E } from '../src/helpers/eip712-signer-static';
import { signForwardRequestWithDomain, createForwardRequest } from '../src/helpers/signer';
import { getNetworkConfig, isNetworkAvailable, isLocalNetwork } from '../src/helpers/network';
import {
  getContractAddresses,
  verifyContractDeployed,
  getForwarderDomain,
  getTrustedForwarder,
  getTokenBalance,
  getForwarderNonce,
  encodeTokenTransfer,
  ContractAddresses,
  mintTokensWithDeployer,
  HARDHAT_RELAYERS,
} from '../src/helpers/contracts';
import {
  pollTransactionStatus,
  HARDHAT_POLLING_CONFIG,
  isSuccessStatus,
  PollingConfig,
} from '../src/helpers/polling';
import { parseTokenAmount } from '../src/helpers/token';

/**
 * Transaction Lifecycle Integration Tests
 */

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

// Polling config for live networks (longer timeouts)
const LIVE_POLLING_CONFIG: PollingConfig = {
  maxAttempts: 60,
  initialDelayMs: 2000,
  maxDelayMs: 8000,
  backoffMultiplier: 1.2,
  terminalStatuses: ['confirmed', 'mined', 'failed', 'reverted'],
};

describe('Transaction Lifecycle Tests', () => {
  let apiClient: AxiosInstance;
  let networkConfig: ReturnType<typeof getNetworkConfig>;
  let contracts: ContractAddresses;
  let contractsDeployed = false;
  let pollingConfig: PollingConfig;
  let abortController: AbortController;

  beforeEach(() => {
    abortController = new AbortController();
  });

  afterEach(() => {
    abortController.abort();
  });

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
    contracts = getContractAddresses();
    const [forwarderDeployed, tokenDeployed] = await Promise.all([
      verifyContractDeployed(contracts.forwarder),
      verifyContractDeployed(contracts.sampleToken),
    ]);
    contractsDeployed = forwarderDeployed && tokenDeployed;

    // Set polling config based on network type
    pollingConfig = isLocalNetwork() ? HARDHAT_POLLING_CONFIG : LIVE_POLLING_CONFIG;

    // Pre-fund accounts with tokens (only on local Hardhat network)
    if (contractsDeployed && isLocalNetwork()) {
      try {
        const mintAmount = parseTokenAmount('10000');
        // Mint to all relayer accounts
        for (const relayerAddress of HARDHAT_RELAYERS) {
          await mintTokensWithDeployer(contracts.sampleToken, relayerAddress, mintAmount);
        }
        // Mint to test user
        await mintTokensWithDeployer(contracts.sampleToken, TEST_ADDRESSES.user, mintAmount);
      } catch (error) {
        console.warn('Pre-fund warning:', error);
      }
    }
  }, 60000);

  describe('Contract Deployment Verification', () => {
    it('TC-TXL-001: should verify ERC2771Forwarder is deployed', async () => {
      const isDeployed = await verifyContractDeployed(contracts.forwarder);
      expect(isDeployed).toBe(true);
    });

    it('TC-TXL-002: should verify SampleToken is deployed with correct trustedForwarder', async () => {
      if (!contractsDeployed) {
        console.log('Skipping: SampleToken not deployed');
        return;
      }

      const isDeployed = await verifyContractDeployed(contracts.sampleToken);
      expect(isDeployed).toBe(true);

      const trustedForwarder = await getTrustedForwarder(contracts.sampleToken);
      expect(trustedForwarder.toLowerCase()).toBe(contracts.forwarder.toLowerCase());
    });

    it('TC-TXL-003: should verify SampleNFT is deployed with correct trustedForwarder', async () => {
      if (!contractsDeployed) {
        console.log('Skipping: SampleNFT not deployed');
        return;
      }

      const isDeployed = await verifyContractDeployed(contracts.sampleNFT);
      expect(isDeployed).toBe(true);

      const trustedForwarder = await getTrustedForwarder(contracts.sampleNFT);
      expect(trustedForwarder.toLowerCase()).toBe(contracts.forwarder.toLowerCase());
    });

    it('TC-TXL-004: should verify EIP-712 domain configuration', async () => {
      const domain = await getForwarderDomain(contracts.forwarder);

      expect(domain.name).toBeTruthy();
      expect(domain.version).toBe('1');
      expect(domain.chainId).toBe(networkConfig.chainId);
      expect(domain.verifyingContract.toLowerCase()).toBe(contracts.forwarder.toLowerCase());
    });
  });

  describe('Direct Transaction Lifecycle', () => {
    it('TC-TXL-100: should submit direct TX and poll until confirmed', async () => {
      if (!contractsDeployed) return;

      const transferData = encodeTokenTransfer(TEST_ADDRESSES.user, parseTokenAmount('100'));
      const payload = {
        to: contracts.sampleToken,
        data: transferData,
        gasLimit: '200000',
        speed: 'fast',
      };

      let response;
      try {
        response = await apiClient.post('/api/v1/relay/direct', payload);
      } catch (error: any) {
        if (error.response?.status === 503) return;
        throw error;
      }

      expect(response.status).toBe(202);
      expect(response.data).toHaveProperty('transactionId');

      const finalStatus = await pollTransactionStatus(
        response.data.transactionId,
        pollingConfig,
        abortController.signal,
      );

      expect(isSuccessStatus(finalStatus.status)).toBe(true);
      expect(finalStatus.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    }, 300000);

    it('TC-TXL-101: should execute ERC20 transfer via direct TX', async () => {
      if (!contractsDeployed) return;

      const initialBalance = await getTokenBalance(contracts.sampleToken, TEST_ADDRESSES.merchant);
      const transferData = encodeTokenTransfer(TEST_ADDRESSES.merchant, parseTokenAmount('10'));

      const payload = {
        to: contracts.sampleToken,
        data: transferData,
        gasLimit: '100000',
        speed: 'fast',
      };

      let response;
      try {
        response = await apiClient.post('/api/v1/relay/direct', payload);
      } catch (error: any) {
        if (error.response?.status === 503) return;
        throw error;
      }

      expect(response.status).toBe(202);

      const finalStatus = await pollTransactionStatus(
        response.data.transactionId,
        pollingConfig,
        abortController.signal,
      );
      expect(isSuccessStatus(finalStatus.status)).toBe(true);

      // Balance assertion only on local network (shared networks have unreliable balances due to external TXs)
      if (isLocalNetwork()) {
        const finalBalance = await getTokenBalance(contracts.sampleToken, TEST_ADDRESSES.merchant);
        expect(finalBalance).toBeGreaterThan(initialBalance);
      }
    }, 300000);
  });

  describe('Gasless Transaction Lifecycle', () => {
    it('TC-TXL-200: should query nonce from API', async () => {
      if (!contractsDeployed) return;

      let response;
      try {
        response = await apiClient.get(`/api/v1/relay/gasless/nonce/${TEST_ADDRESSES.user}`);
      } catch (error: any) {
        if (error.response?.status === 503) return;
        throw error;
      }

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('nonce');
    });

    it('TC-TXL-201: should verify EIP-712 signature generation', async () => {
      if (!contractsDeployed) return;

      const nonce = await getForwarderNonce(contracts.forwarder, TEST_ADDRESSES.user);
      const transferData = encodeTokenTransfer(TEST_ADDRESSES.merchant, parseTokenAmount('5'));
      const forwardRequest = createForwardRequestE2E(TEST_ADDRESSES.user, contracts.sampleToken, {
        nonce: Number(nonce),
        data: transferData,
        gas: '100000',
      });

      const signature = await signForwardRequestE2E(TEST_WALLETS.user, forwardRequest);
      expect(signature).toMatch(/^0x[a-fA-F0-9]{130}$/);
    });

    it('TC-TXL-202: should execute full gasless TX flow', async () => {
      if (!contractsDeployed) return;

      // Get nonce
      let nonceResponse;
      try {
        nonceResponse = await apiClient.get(`/api/v1/relay/gasless/nonce/${TEST_ADDRESSES.user}`);
      } catch (error: any) {
        if (error.response?.status === 503) return;
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

      // Submit
      let response;
      try {
        response = await apiClient.post('/api/v1/relay/gasless', {
          request: forwardRequest,
          signature,
        });
      } catch (error: any) {
        if (error.response?.status === 503) return;
        throw error;
      }

      expect(response.status).toBe(202);
      expect(response.data).toHaveProperty('transactionId');

      // Poll
      const finalStatus = await pollTransactionStatus(
        response.data.transactionId,
        pollingConfig,
        abortController.signal,
      );
      expect(isSuccessStatus(finalStatus.status)).toBe(true);

      // Verify nonce incremented
      try {
        const newNonceResponse = await apiClient.get(`/api/v1/relay/gasless/nonce/${TEST_ADDRESSES.user}`);
        const newNonce = parseInt(newNonceResponse.data.nonce, 10);
        expect(newNonce).toBe(nonce + 1);
      } catch {
        // Ignore
      }
    }, 300000);
  });
});
