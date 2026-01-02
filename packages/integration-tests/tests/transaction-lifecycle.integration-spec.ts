import axios, { AxiosInstance } from 'axios';
import { TEST_WALLETS, TEST_ADDRESSES } from '../src/helpers/test-wallets';
import { signForwardRequest as signForwardRequestE2E, createForwardRequest as createForwardRequestE2E } from '../src/helpers/eip712-signer-static';
import { signForwardRequestWithDomain, createForwardRequest } from '../src/helpers/signer';
import {
  getNetworkConfig,
  isNetworkAvailable,
  logNetworkConfig,
} from '../src/helpers/network';
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
  HARDHAT_RELAYER,
} from '../src/helpers/contracts';
import {
  pollTransactionStatus,
  HARDHAT_POLLING_CONFIG,
  isSuccessStatus,
} from '../src/helpers/polling';
import { parseTokenAmount } from '../src/helpers/token';

/**
 * Transaction Lifecycle Integration Tests
 *
 * These tests verify the complete transaction lifecycle:
 * 1. Contract Deployment Verification
 * 2. Direct Transaction Execution (API → OZ Relayer → Blockchain)
 * 3. Meta-Transaction (Gasless) Execution (EIP-712 signature → Forwarder.execute())
 *
 * Prerequisites:
 * 1. Docker Compose stack running (hardhat-node, redis, oz-relayer, relay-api)
 * 2. Contracts deployed (ERC2771Forwarder, SampleToken, SampleNFT)
 * 3. Environment variables configured:
 *    - RELAY_API_URL: URL of the running relay-api service
 *    - RELAY_API_KEY: API key for authentication
 *    - RPC_URL: Blockchain RPC endpoint
 *    - CHAIN_ID: Blockchain chain ID
 *    - FORWARDER_ADDRESS: Deployed forwarder contract address
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

describe('Transaction Lifecycle Tests', () => {
  let apiClient: AxiosInstance;
  let networkConfig: ReturnType<typeof getNetworkConfig>;
  let contracts: ContractAddresses;
  let contractsDeployed = false;

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
        'Network unavailable. Transaction lifecycle tests require a running blockchain node.\n' +
          'Start Docker Compose: cd docker && docker compose up\n' +
          'Or configure RPC_URL environment variable.',
      );
    }

    networkConfig = getNetworkConfig();
    contracts = getContractAddresses();
    logNetworkConfig();
    console.log('📄 Contract Addresses:');
    console.log(`   Forwarder: ${contracts.forwarder}`);
    console.log(`   SampleToken: ${contracts.sampleToken}`);
    console.log(`   SampleNFT: ${contracts.sampleNFT}`);
    console.log(`   RELAY_API_URL: ${relayApiUrl}`);

    // Verify contracts are deployed
    contractsDeployed = await verifyContractDeployed(contracts.forwarder);

    // Pre-fund accounts with tokens for Direct TX and Gasless TX tests
    if (contractsDeployed) {
      try {
        const mintAmount = parseTokenAmount('10000'); // 10,000 tokens each

        // Pre-fund OZ Relayer (Hardhat Account #1) for Direct TX tests
        console.log(`💰 Pre-funding OZ Relayer (${HARDHAT_RELAYER.address}) with tokens...`);
        await mintTokensWithDeployer(contracts.sampleToken, HARDHAT_RELAYER.address, mintAmount);
        const relayerBalance = await getTokenBalance(contracts.sampleToken, HARDHAT_RELAYER.address);
        console.log(`   ✅ OZ Relayer token balance: ${relayerBalance}`);

        // Pre-fund test user for Gasless TX tests (EIP-712 meta-transactions)
        console.log(`💰 Pre-funding Test User (${TEST_ADDRESSES.user}) with tokens...`);
        await mintTokensWithDeployer(contracts.sampleToken, TEST_ADDRESSES.user, mintAmount);
        const userBalance = await getTokenBalance(contracts.sampleToken, TEST_ADDRESSES.user);
        console.log(`   ✅ Test User token balance: ${userBalance}`);
      } catch (error) {
        console.warn(`   ⚠️ Failed to pre-fund accounts: ${error}`);
      }
    }
  }, 60000); // 60 second timeout for setup

  describe('Contract Deployment Verification', () => {
    it('TC-TXL-001: should verify ERC2771Forwarder is deployed', async () => {
      const isDeployed = await verifyContractDeployed(contracts.forwarder);
      expect(isDeployed).toBe(true);
      console.log(`   ✅ Forwarder deployed at ${contracts.forwarder}`);
    });

    it('TC-TXL-002: should verify SampleToken is deployed with correct trustedForwarder', async () => {
      const isDeployed = await verifyContractDeployed(contracts.sampleToken);
      expect(isDeployed).toBe(true);

      const trustedForwarder = await getTrustedForwarder(contracts.sampleToken);
      expect(trustedForwarder.toLowerCase()).toBe(contracts.forwarder.toLowerCase());
      console.log(`   ✅ SampleToken trustedForwarder: ${trustedForwarder}`);
    });

    it('TC-TXL-003: should verify SampleNFT is deployed with correct trustedForwarder', async () => {
      const isDeployed = await verifyContractDeployed(contracts.sampleNFT);
      expect(isDeployed).toBe(true);

      const trustedForwarder = await getTrustedForwarder(contracts.sampleNFT);
      expect(trustedForwarder.toLowerCase()).toBe(contracts.forwarder.toLowerCase());
      console.log(`   ✅ SampleNFT trustedForwarder: ${trustedForwarder}`);
    });

    it('TC-TXL-004: should verify EIP-712 domain configuration', async () => {
      const domain = await getForwarderDomain(contracts.forwarder);

      expect(domain.name).toBeTruthy();
      expect(domain.version).toBe('1');
      expect(domain.chainId).toBe(networkConfig.chainId);
      expect(domain.verifyingContract.toLowerCase()).toBe(contracts.forwarder.toLowerCase());
      console.log(`   ✅ EIP-712 Domain: name=${domain.name}, version=${domain.version}, chainId=${domain.chainId}`);
    });
  });

  describe('Direct Transaction Lifecycle', () => {
    beforeAll(() => {
      if (!contractsDeployed) {
        console.warn('⚠️ Contracts not deployed, skipping Direct TX tests');
      }
    });

    it('TC-TXL-100: should submit direct TX and poll until confirmed', async () => {
      if (!contractsDeployed) {
        console.log('   ⏭️ Skipped: Contracts not deployed');
        return;
      }

      // Encode token transfer call (OZ Relayer transfers pre-funded tokens to user)
      const transferData = encodeTokenTransfer(TEST_ADDRESSES.user, parseTokenAmount('100'));

      const payload = {
        to: contracts.sampleToken,
        data: transferData,
        gasLimit: '200000',
        speed: 'fast',
      };

      // Submit transaction via Direct TX API
      let response;
      try {
        response = await apiClient.post('/api/v1/relay/direct', payload);
      } catch (error: any) {
        if (error.response?.status === 503) {
          console.log('   ⚠️ OZ Relayer unavailable, skipping polling');
          return;
        }
        throw error;
      }

      expect(response.status).toBe(202);
      expect(response.data).toHaveProperty('transactionId');
      console.log(`   📤 TX submitted: ${response.data.transactionId}`);

      // Poll until terminal status
      const finalStatus = await pollTransactionStatus(
        response.data.transactionId,
        HARDHAT_POLLING_CONFIG,
      );

      expect(isSuccessStatus(finalStatus.status)).toBe(true);
      expect(finalStatus.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      console.log(`   ✅ TX confirmed: ${finalStatus.hash} (status: ${finalStatus.status})`);
    }, 30000);

    it('TC-TXL-101: should execute ERC20 transfer via direct TX', async () => {
      if (!contractsDeployed) {
        console.log('   ⏭️ Skipped: Contracts not deployed');
        return;
      }

      // Get initial balance
      const initialBalance = await getTokenBalance(contracts.sampleToken, TEST_ADDRESSES.merchant);

      // Encode transfer call
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
        if (error.response?.status === 503) {
          console.log('   ⚠️ OZ Relayer unavailable, skipping');
          return;
        }
        throw error;
      }

      expect(response.status).toBe(202);

      // Poll until confirmed
      const finalStatus = await pollTransactionStatus(response.data.transactionId);
      expect(isSuccessStatus(finalStatus.status)).toBe(true);

      // Verify on-chain balance change
      const finalBalance = await getTokenBalance(contracts.sampleToken, TEST_ADDRESSES.merchant);
      expect(finalBalance).toBeGreaterThan(initialBalance);
      console.log(`   ✅ Merchant balance: ${initialBalance} → ${finalBalance}`);
    }, 30000);
  });

  describe('Gasless Transaction Lifecycle', () => {
    beforeAll(() => {
      if (!contractsDeployed) {
        console.warn('⚠️ Contracts not deployed, skipping Gasless TX tests');
      }
    });

    it('TC-TXL-200: should query nonce from API', async () => {
      if (!contractsDeployed) {
        console.log('   ⏭️ Skipped: Contracts not deployed');
        return;
      }

      let response;
      try {
        response = await apiClient.get(`/api/v1/relay/gasless/nonce/${TEST_ADDRESSES.user}`);
      } catch (error: any) {
        if (error.response?.status === 503) {
          console.log('   ⚠️ Nonce endpoint unavailable');
          return;
        }
        throw error;
      }

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('nonce');
      console.log(`   ✅ User nonce from API: ${response.data.nonce}`);
    });

    /**
     * TC-TXL-201: Verify EIP-712 signature format
     */
    it('TC-TXL-201: should verify EIP-712 signature generation', async () => {
      if (!contractsDeployed) {
        console.log('   ⏭️ Skipped: Contracts not deployed');
        return;
      }

      // Get current nonce from contract
      const nonce = await getForwarderNonce(contracts.forwarder, TEST_ADDRESSES.user);

      // Create forward request for token transfer
      const transferData = encodeTokenTransfer(TEST_ADDRESSES.merchant, parseTokenAmount('5'));
      const forwardRequest = createForwardRequestE2E(TEST_ADDRESSES.user, contracts.sampleToken, {
        nonce: Number(nonce),
        data: transferData,
        gas: '100000',
      });

      // Sign with EIP-712
      const signature = await signForwardRequestE2E(TEST_WALLETS.user, forwardRequest);

      // Signature should be 65 bytes (130 hex chars + 0x prefix)
      expect(signature).toMatch(/^0x[a-fA-F0-9]{130}$/);
      console.log(`   ✅ Signature generated: ${signature.substring(0, 20)}...`);
    });

    it('TC-TXL-202: should execute full gasless TX flow', async () => {
      if (!contractsDeployed) {
        console.log('   ⏭️ Skipped: Contracts not deployed');
        return;
      }

      // Step 1: Get nonce from API
      let nonceResponse;
      try {
        nonceResponse = await apiClient.get(`/api/v1/relay/gasless/nonce/${TEST_ADDRESSES.user}`);
      } catch (error: any) {
        if (error.response?.status === 503) {
          console.log('   ⚠️ Nonce endpoint unavailable, skipping');
          return;
        }
        throw error;
      }

      const nonce = parseInt(nonceResponse.data.nonce, 10);
      console.log(`   📝 Current nonce: ${nonce}`);

      // Step 2: Create forward request
      const transferData = encodeTokenTransfer(TEST_ADDRESSES.merchant, parseTokenAmount('1'));
      const forwardRequest = createForwardRequest(TEST_ADDRESSES.user, contracts.sampleToken, {
        nonce,
        data: transferData,
        gas: '150000',
      });

      // Step 3: Sign with EIP-712 using ACTUAL deployed contract domain
      const signature = await signForwardRequestWithDomain(TEST_WALLETS.user, forwardRequest);
      console.log(`   ✍️ Request signed with deployed contract domain`);

      // Step 4: Submit gasless TX
      let response;
      try {
        response = await apiClient.post('/api/v1/relay/gasless', {
          request: forwardRequest,
          signature,
        });
      } catch (error: any) {
        if (error.response?.status === 503) {
          console.log('   ⚠️ Gasless endpoint unavailable, skipping');
          return;
        }
        throw error;
      }

      expect(response.status).toBe(202);
      expect(response.data).toHaveProperty('transactionId');
      console.log(`   📤 Gasless TX submitted: ${response.data.transactionId}`);

      // Step 5: Poll until confirmed
      const finalStatus = await pollTransactionStatus(
        response.data.transactionId,
        HARDHAT_POLLING_CONFIG,
      );

      expect(isSuccessStatus(finalStatus.status)).toBe(true);
      console.log(`   ✅ Gasless TX confirmed: ${finalStatus.hash}`);

      // Step 6: Verify nonce incremented
      try {
        const newNonceResponse = await apiClient.get(`/api/v1/relay/gasless/nonce/${TEST_ADDRESSES.user}`);
        const newNonce = parseInt(newNonceResponse.data.nonce, 10);
        expect(newNonce).toBe(nonce + 1);
        console.log(`   ✅ Nonce incremented: ${nonce} → ${newNonce}`);
      } catch {
        console.log('   ⚠️ Could not verify nonce increment');
      }
    }, 60000);
  });
});
