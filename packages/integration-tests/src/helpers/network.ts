import { ethers, JsonRpcProvider } from 'ethers';

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
 * Check if the RPC endpoint is available
 * @returns true if the network is reachable
 */
export async function isNetworkAvailable(): Promise<boolean> {
  const provider = createProvider();
  try {
    await provider.getBlockNumber();
    return true;
  } catch {
    return false;
  } finally {
    provider.destroy();
  }
}

/**
 * Get the balance of an address
 * @param address - Ethereum address to check
 */
export async function getBalance(address: string): Promise<bigint> {
  const provider = createProvider();
  try {
    return await provider.getBalance(address);
  } finally {
    provider.destroy();
  }
}

/**
 * Check if running on local Hardhat/Anvil network
 * Local networks have chainId 31337
 */
export function isLocalNetwork(): boolean {
  const { chainId } = getNetworkConfig();
  return chainId === 31337;
}

