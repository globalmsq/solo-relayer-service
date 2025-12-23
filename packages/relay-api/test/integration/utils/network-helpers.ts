import { ethers, JsonRpcProvider, Wallet } from 'ethers';

/**
 * Network Agnostic Configuration
 *
 * This module provides network-agnostic utilities for integration tests.
 * The RPC_URL environment variable determines which network to use:
 * - Hardhat: http://localhost:8545 (default, fast, free)
 * - Amoy: https://rpc-amoy.polygon.technology
 * - Mainnet: https://polygon-mainnet.infura.io/v3/...
 */

export interface NetworkConfig {
  rpcUrl: string;
  chainId: number;
  forwarderAddress: string;
}

/**
 * Get network configuration from environment variables
 * Network agnostic - same code works on any network
 */
export function getNetworkConfig(): NetworkConfig {
  const rpcUrl = process.env.RPC_URL || 'http://localhost:8545';
  const chainId = parseInt(process.env.CHAIN_ID || '31337', 10);
  const forwarderAddress =
    process.env.FORWARDER_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3';

  return {
    rpcUrl,
    chainId,
    forwarderAddress,
  };
}

/**
 * Create a JSON-RPC provider for the configured network
 */
export function createProvider(): JsonRpcProvider {
  const { rpcUrl } = getNetworkConfig();
  return new ethers.JsonRpcProvider(rpcUrl);
}

/**
 * Create a wallet connected to the configured network
 * @param privateKey - Private key for the wallet
 */
export function createWallet(privateKey: string): Wallet {
  const provider = createProvider();
  return new Wallet(privateKey, provider);
}

/**
 * Check if the RPC endpoint is available
 * @returns true if the network is reachable
 */
export async function isNetworkAvailable(): Promise<boolean> {
  try {
    const provider = createProvider();
    await provider.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current block number from the network
 */
export async function getBlockNumber(): Promise<number> {
  const provider = createProvider();
  return provider.getBlockNumber();
}

/**
 * Get the balance of an address
 * @param address - Ethereum address to check
 */
export async function getBalance(address: string): Promise<bigint> {
  const provider = createProvider();
  return provider.getBalance(address);
}

/**
 * Wait for a transaction to be confirmed
 * @param txHash - Transaction hash to wait for
 * @param confirmations - Number of confirmations to wait for (default: 1)
 */
export async function waitForTransaction(
  txHash: string,
  confirmations = 1,
): Promise<ethers.TransactionReceipt | null> {
  const provider = createProvider();
  return provider.waitForTransaction(txHash, confirmations);
}

/**
 * Skip test if network is not available
 * Use in beforeAll() to skip integration tests when RPC is unavailable
 */
export async function skipIfNetworkUnavailable(): Promise<void> {
  const available = await isNetworkAvailable();
  if (!available) {
    const { rpcUrl } = getNetworkConfig();
    console.warn(`⚠️ Skipping integration tests: Network unavailable at ${rpcUrl}`);
    // Jest will skip remaining tests in the suite
    throw new Error(`Network unavailable at ${rpcUrl}. Skipping integration tests.`);
  }
}

/**
 * Log network configuration for debugging
 */
export function logNetworkConfig(): void {
  const config = getNetworkConfig();
  console.log('🔗 Network Configuration:');
  console.log(`   RPC URL: ${config.rpcUrl}`);
  console.log(`   Chain ID: ${config.chainId}`);
  console.log(`   Forwarder: ${config.forwarderAddress}`);
}
