import { ethers, Interface } from 'ethers';

/**
 * Token Helper Utilities for Integration Tests
 *
 * Provides encoding functions for common token operations.
 * Works with any ERC-20 compatible token on any network.
 */

// Standard ERC-20 ABI for common operations
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

// ERC2771Forwarder ABI for meta-transactions
const FORWARDER_ABI = [
  'function nonces(address owner) view returns (uint256)',
  'function execute((address from, address to, uint256 value, uint256 gas, uint256 nonce, uint48 deadline, bytes data) request, bytes signature) payable returns (bool)',
  'function verify((address from, address to, uint256 value, uint256 gas, uint256 nonce, uint48 deadline, bytes data) request, bytes signature) view returns (bool)',
];

const erc20Interface = new Interface(ERC20_ABI);
const forwarderInterface = new Interface(FORWARDER_ABI);

/**
 * Encode ERC-20 transfer function call
 * @param to - Recipient address
 * @param amount - Amount to transfer (in smallest unit, e.g., wei)
 */
export function encodeTransfer(to: string, amount: bigint | string): string {
  return erc20Interface.encodeFunctionData('transfer', [to, amount]);
}

/**
 * Encode ERC-20 approve function call
 * @param spender - Address to approve
 * @param amount - Amount to approve (in smallest unit)
 */
export function encodeApprove(spender: string, amount: bigint | string): string {
  return erc20Interface.encodeFunctionData('approve', [spender, amount]);
}

/**
 * Encode balanceOf query
 * @param owner - Address to query balance of
 */
export function encodeBalanceOf(owner: string): string {
  return erc20Interface.encodeFunctionData('balanceOf', [owner]);
}

/**
 * Decode balanceOf result
 * @param data - Encoded result from balanceOf call
 */
export function decodeBalanceOf(data: string): bigint {
  const [balance] = erc20Interface.decodeFunctionResult('balanceOf', data);
  return balance;
}

/**
 * Encode nonces query for Forwarder contract
 * @param owner - Address to query nonce for
 */
export function encodeNonces(owner: string): string {
  return forwarderInterface.encodeFunctionData('nonces', [owner]);
}

/**
 * Decode nonces result
 * @param data - Encoded result from nonces call
 */
export function decodeNonces(data: string): bigint {
  const [nonce] = forwarderInterface.decodeFunctionResult('nonces', data);
  return nonce;
}

/**
 * Format token amount with decimals
 * @param amount - Amount in human-readable form
 * @param decimals - Number of decimals (default: 18)
 */
export function parseTokenAmount(amount: string | number, decimals = 18): bigint {
  return ethers.parseUnits(String(amount), decimals);
}

/**
 * Format token amount for display
 * @param amount - Amount in smallest unit
 * @param decimals - Number of decimals (default: 18)
 */
export function formatTokenAmount(amount: bigint, decimals = 18): string {
  return ethers.formatUnits(amount, decimals);
}

/**
 * Create a deadline timestamp (seconds since epoch)
 * @param minutes - Minutes from now (default: 60)
 */
export function createDeadline(minutes = 60): number {
  return Math.floor(Date.now() / 1000) + minutes * 60;
}

/**
 * Check if a deadline has expired
 * @param deadline - Deadline timestamp (seconds since epoch)
 */
export function isDeadlineExpired(deadline: number): boolean {
  return Math.floor(Date.now() / 1000) > deadline;
}
