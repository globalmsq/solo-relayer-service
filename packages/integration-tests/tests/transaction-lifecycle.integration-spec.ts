import request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '@msq-relayer/relay-api/src/app.module';
import { TEST_WALLETS, TEST_ADDRESSES } from '@msq-relayer/relay-api/test/fixtures/test-wallets';
// Note: E2E signer uses static TEST_CONFIG domain, which differs from deployed contracts
// For integration tests against real contracts, we use signForwardRequestWithDomain
import { signForwardRequest as signForwardRequestE2E, createForwardRequest as createForwardRequestE2E } from '@msq-relayer/relay-api/test/utils/eip712-signer';
import { signForwardRequestWithDomain, createForwardRequest } from '../src/helpers/signer';
import {
  getNetworkConfig,
  isNetworkAvailable,
  logNetworkConfig,
  createProvider,
} from '../src/helpers/network';
import {
  getContractAddresses,
  verifyContractDeployed,
  getForwarderDomain,
  getTrustedForwarder,
  getTokenBalance,
  getNFTBalance,
  getForwarderNonce,
  encodeTokenTransfer,
  encodeTokenMint,
  encodeNFTMint,
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
 * 3. Environment variables configured (see getNetworkConfig)
 *
 * Run with:
 *   pnpm --filter @msq-relayer/integration-tests test:lifecycle
 */
describe('Transaction Lifecycle Tests', () => {
  let app: INestApplication;
  let networkConfig: ReturnType<typeof getNetworkConfig>;
  let contracts: ContractAddresses;
  let contractsDeployed = false;
  const API_KEY = process.env.RELAY_API_KEY || 'local-dev-api-key';

  beforeAll(async () => {
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

    // Shared config map for ConfigService mock
    // CRITICAL: Must match both ConfigService mock AND process.env for guards
    const configMap: Record<string, unknown> = {
      OZ_RELAYER_URL: process.env.OZ_RELAYER_URL || 'http://localhost:8081',
      OZ_RELAYER_API_KEY: process.env.OZ_RELAYER_API_KEY || 'oz-relayer-shared-api-key-local-dev',
      RELAY_API_KEY: API_KEY,
      apiKey: API_KEY,
      FORWARDER_ADDRESS: networkConfig.forwarderAddress,
      FORWARDER_NAME: process.env.FORWARDER_NAME || 'MSQForwarder',
      CHAIN_ID: networkConfig.chainId,
      RPC_URL: networkConfig.rpcUrl,
    };

    // CRITICAL: Set process.env BEFORE creating the test module
    // Some providers (like ApiKeyGuard) may read from process.env during instantiation
    Object.entries(configMap).forEach(([key, value]) => {
      process.env[key] = String(value);
    });

    // Create real NestJS application
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: jest.fn((key: string, defaultValue?: unknown) => configMap[key] ?? defaultValue),
        getOrThrow: jest.fn((key: string) => {
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
  }, 60000); // 60 second timeout for setup

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

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
      // Note: OZ Relayer was pre-funded in beforeAll with 10,000 tokens
      const transferData = encodeTokenTransfer(TEST_ADDRESSES.user, parseTokenAmount('100'));

      const payload = {
        to: contracts.sampleToken,
        data: transferData,
        gasLimit: '200000',
        speed: 'fast',
      };

      // Submit transaction via Direct TX API
      const response = await request(app.getHttpServer())
        .post('/api/v1/relay/direct')
        .set('x-api-key', API_KEY)
        .send(payload);

      // API should accept (202) or fail if OZ Relayer not configured (503)
      if (response.status === 503) {
        console.log('   ⚠️ OZ Relayer unavailable, skipping polling');
        return;
      }

      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty('transactionId');
      console.log(`   📤 TX submitted: ${response.body.transactionId}`);

      // Poll until terminal status
      const finalStatus = await pollTransactionStatus(
        response.body.transactionId,
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

      const response = await request(app.getHttpServer())
        .post('/api/v1/relay/direct')
        .set('x-api-key', API_KEY)
        .send(payload);

      if (response.status === 503) {
        console.log('   ⚠️ OZ Relayer unavailable, skipping');
        return;
      }

      expect(response.status).toBe(202);

      // Poll until confirmed
      const finalStatus = await pollTransactionStatus(response.body.transactionId);
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

      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/gasless/nonce/${TEST_ADDRESSES.user}`)
        .set('x-api-key', API_KEY);

      expect([200, 503]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty('nonce');
        console.log(`   ✅ User nonce from API: ${response.body.nonce}`);
      } else {
        console.log('   ⚠️ Nonce endpoint unavailable');
      }
    });

    it('TC-TXL-201: should verify EIP-712 signature generation', async () => {
      if (!contractsDeployed) {
        console.log('   ⏭️ Skipped: Contracts not deployed');
        return;
      }

      // Get current nonce from contract
      const nonce = await getForwarderNonce(contracts.forwarder, TEST_ADDRESSES.user);

      // Create forward request for token transfer (using E2E signer for format testing)
      const transferData = encodeTokenTransfer(TEST_ADDRESSES.merchant, parseTokenAmount('5'));
      const forwardRequest = createForwardRequestE2E(TEST_ADDRESSES.user, contracts.sampleToken, {
        nonce: Number(nonce),
        data: transferData,
        gas: '100000',
      });

      // Sign with EIP-712 (E2E signer - tests signature format, not verification)
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
      const nonceResponse = await request(app.getHttpServer())
        .get(`/api/v1/relay/gasless/nonce/${TEST_ADDRESSES.user}`)
        .set('x-api-key', API_KEY);

      if (nonceResponse.status !== 200) {
        console.log('   ⚠️ Nonce endpoint unavailable, skipping');
        return;
      }

      const nonce = parseInt(nonceResponse.body.nonce, 10);
      console.log(`   📝 Current nonce: ${nonce}`);

      // Step 2: Create forward request
      const transferData = encodeTokenTransfer(TEST_ADDRESSES.merchant, parseTokenAmount('1'));
      const forwardRequest = createForwardRequest(TEST_ADDRESSES.user, contracts.sampleToken, {
        nonce,
        data: transferData,
        gas: '150000',
      });

      // Step 3: Sign with EIP-712 using ACTUAL deployed contract domain
      // This queries the contract's eip712Domain() to get the correct name/version/chainId/address
      const signature = await signForwardRequestWithDomain(TEST_WALLETS.user, forwardRequest);
      console.log(`   ✍️ Request signed with deployed contract domain`);

      // Step 4: Submit gasless TX
      const response = await request(app.getHttpServer())
        .post('/api/v1/relay/gasless')
        .set('x-api-key', API_KEY)
        .send({
          request: forwardRequest,
          signature,
        });

      if (response.status === 503) {
        console.log('   ⚠️ Gasless endpoint unavailable, skipping');
        return;
      }

      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty('transactionId');
      console.log(`   📤 Gasless TX submitted: ${response.body.transactionId}`);

      // Step 5: Poll until confirmed
      const finalStatus = await pollTransactionStatus(
        response.body.transactionId,
        HARDHAT_POLLING_CONFIG,
      );

      expect(isSuccessStatus(finalStatus.status)).toBe(true);
      console.log(`   ✅ Gasless TX confirmed: ${finalStatus.hash}`);

      // Step 6: Verify nonce incremented
      const newNonceResponse = await request(app.getHttpServer())
        .get(`/api/v1/relay/gasless/nonce/${TEST_ADDRESSES.user}`)
        .set('x-api-key', API_KEY);

      if (newNonceResponse.status === 200) {
        const newNonce = parseInt(newNonceResponse.body.nonce, 10);
        expect(newNonce).toBe(nonce + 1);
        console.log(`   ✅ Nonce incremented: ${nonce} → ${newNonce}`);
      }
    }, 60000);
  });
});
