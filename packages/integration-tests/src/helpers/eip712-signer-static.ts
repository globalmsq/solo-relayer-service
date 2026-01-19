import { Wallet } from 'ethers';
import { getContractAddresses } from './contracts';

/**
 * EIP-712 Signer with Static Domain (for E2E-style testing)
 *
 * This signer uses a static EIP-712 domain configuration,
 * matching the E2E test approach. Use signForwardRequestWithDomain
 * from signer.ts for integration tests against real deployed contracts.
 */

/**
 * Get static EIP-712 domain for testing
 * Uses environment-configured forwarder address
 */
function getStaticDomain() {
  const contracts = getContractAddresses();
  const chainId = parseInt(process.env.CHAIN_ID || '31337', 10);
  const forwarderName = process.env.FORWARDER_NAME || 'ERC2771Forwarder';

  return {
    name: forwarderName,
    version: '1',
    chainId,
    verifyingContract: contracts.forwarder,
  };
}

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

export interface ForwardRequest {
  from: string;
  to: string;
  value: string;
  gas: string;
  nonce: string;
  deadline: string;
  data: string;
}

/**
 * Sign a ForwardRequest with static EIP-712 domain
 *
 * Note: This uses environment-configured domain, not queried from contract.
 * For production-like tests, use signForwardRequestWithDomain from signer.ts.
 */
export async function signForwardRequest(
  wallet: Wallet,
  request: ForwardRequest,
): Promise<string> {
  const domain = getStaticDomain();
  return wallet.signTypedData(domain, FORWARD_REQUEST_TYPE, request);
}

/**
 * Create a ForwardRequest with default values (E2E style)
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
    gas: '100000',
    nonce: String(nonce),
    deadline: String(Math.floor(Date.now() / 1000) + 3600), // 1 hour later
    data: '0x00',
    ...restOptions,
  };
}

