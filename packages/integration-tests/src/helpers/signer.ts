import { Wallet } from 'ethers';
import { getForwarderDomain, getContractAddresses } from './contracts';

/**
 * EIP-712 Signer Utilities for Integration Tests
 *
 * Key difference from E2E tests:
 * - E2E tests use TEST_CONFIG (static, hardcoded domain)
 * - Integration tests query actual deployed contract domain via eip712Domain()
 *
 * This ensures signature verification works with the real deployed contracts.
 */

/**
 * EIP-712 ForwardRequest type structure
 * Must match ERC2771Forwarder contract exactly (7 fields)
 */
const FORWARD_REQUEST_TYPE = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint48' },
    { name: 'data', type: 'bytes' },
  ],
};

/**
 * ForwardRequest interface matching ERC2771Forwarder struct
 */
export interface ForwardRequest {
  from: string;
  to: string;
  value: string;
  gas: string;
  nonce: string;
  deadline: number;
  data: string;
}

/**
 * Sign a ForwardRequest with EIP-712 using actual deployed contract domain
 *
 * Process:
 * 1. Query domain from deployed ERC2771Forwarder contract
 * 2. Sign with ethers.js signTypedData()
 * 3. Return 65-byte signature (0x + 130 hex chars)
 *
 * @param wallet - ethers.js Wallet to sign with (must match request.from)
 * @param request - ForwardRequest to sign
 * @returns EIP-712 signature string
 */
export async function signForwardRequestWithDomain(
  wallet: Wallet,
  request: ForwardRequest,
): Promise<string> {
  const contracts = getContractAddresses();
  const domain = await getForwarderDomain(contracts.forwarder);

  return wallet.signTypedData(domain, FORWARD_REQUEST_TYPE, request);
}

/**
 * Create a ForwardRequest with default values
 *
 * @param from - Sender address (must match signer)
 * @param to - Target contract address
 * @param options - Override default values
 * @returns ForwardRequest ready for signing
 */
export function createForwardRequest(
  from: string,
  to: string,
  options: Partial<Omit<ForwardRequest, 'nonce'>> & { nonce?: number } = {},
): ForwardRequest {
  const { nonce = 0, ...restOptions } = options;
  return {
    from,
    to,
    value: '0',
    gas: '150000', // Higher default gas for Forwarder overhead
    nonce: String(nonce),
    deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    data: '0x00', // Empty call data (just transfer ETH or test call)
    ...restOptions,
  };
}
