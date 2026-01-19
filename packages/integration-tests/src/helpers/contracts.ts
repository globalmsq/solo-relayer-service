import { ethers, Contract, Interface } from 'ethers';
import { createProvider } from './network';

/**
 * Contract Helper Utilities for Integration Tests
 *
 * Provides contract verification and interaction utilities.
 * Works with deployed contracts on any network.
 */

/**
 * Deployed contract addresses
 */
export interface ContractAddresses {
  forwarder: string;
  sampleToken: string;
  sampleNFT: string;
}

/**
 * Minimal ABI for ERC2771Forwarder (OpenZeppelin)
 */
export const FORWARDER_ABI = [
  'function eip712Domain() view returns (bytes1, string, string, uint256, address, bytes32, uint256[])',
  'function nonces(address owner) view returns (uint256)',
  'function verify((address from, address to, uint256 value, uint256 gas, uint256 nonce, uint48 deadline, bytes data) request, bytes signature) view returns (bool)',
  'function execute((address from, address to, uint256 value, uint256 gas, uint256 nonce, uint48 deadline, bytes data) request, bytes signature) payable returns (bool)',
];

/**
 * Minimal ABI for ERC2771 context contracts (SampleToken, SampleNFT)
 */
export const ERC2771_CONTEXT_ABI = [
  'function trustedForwarder() view returns (address)',
  'function isTrustedForwarder(address forwarder) view returns (bool)',
];

/**
 * Minimal ABI for SampleToken (ERC20)
 */
export const SAMPLE_TOKEN_ABI = [
  ...ERC2771_CONTEXT_ABI,
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function mint(address to, uint256 amount)',
];

/**
 * Minimal ABI for SampleNFT (ERC721)
 */
export const SAMPLE_NFT_ABI = [
  ...ERC2771_CONTEXT_ABI,
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function approve(address to, uint256 tokenId)',
  'function safeMint(address to)',
  'function tokenCounter() view returns (uint256)',
];

/**
 * Get contract addresses from environment variables
 *
 * Default addresses are Hardhat deployment slots:
 * - Slot 0: Forwarder (0x5Fb...)
 * - Slot 1: SampleToken (0xe7f...)
 * - Slot 2: SampleNFT (0x9fE...)
 */
export function getContractAddresses(): ContractAddresses {
  return {
    forwarder: process.env.FORWARDER_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    sampleToken: process.env.SAMPLE_TOKEN_ADDRESS || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    sampleNFT: process.env.SAMPLE_NFT_ADDRESS || '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
  };
}

/**
 * Verify that a contract is deployed at the given address
 * @param address - Contract address to verify
 * @returns true if bytecode exists at address
 */
export async function verifyContractDeployed(address: string): Promise<boolean> {
  const provider = createProvider();
  try {
    const code = await provider.getCode(address);
    return code !== '0x' && code !== '0x0';
  } finally {
    provider.destroy();
  }
}

/**
 * Get EIP-712 domain from Forwarder contract
 * @param forwarderAddress - ERC2771Forwarder address
 */
export async function getForwarderDomain(forwarderAddress: string): Promise<{
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}> {
  const provider = createProvider();
  try {
    const forwarder = new Contract(forwarderAddress, FORWARDER_ABI, provider);
    const domain = await forwarder.eip712Domain();

    return {
      name: domain[1],
      version: domain[2],
      chainId: Number(domain[3]),
      verifyingContract: domain[4],
    };
  } finally {
    provider.destroy();
  }
}

/**
 * Get trusted forwarder address from an ERC2771 context contract
 * @param contractAddress - Contract address (SampleToken or SampleNFT)
 */
export async function getTrustedForwarder(contractAddress: string): Promise<string> {
  const provider = createProvider();
  try {
    const contract = new Contract(contractAddress, ERC2771_CONTEXT_ABI, provider);
    return await contract.trustedForwarder();
  } finally {
    provider.destroy();
  }
}

/**
 * Get ERC20 token balance
 * @param tokenAddress - Token contract address
 * @param account - Account to check balance for
 */
export async function getTokenBalance(tokenAddress: string, account: string): Promise<bigint> {
  const provider = createProvider();
  try {
    const token = new Contract(tokenAddress, SAMPLE_TOKEN_ABI, provider);
    return await token.balanceOf(account);
  } finally {
    provider.destroy();
  }
}

/**
 * Get ERC721 NFT balance
 * @param nftAddress - NFT contract address
 * @param account - Account to check balance for
 */
export async function getNFTBalance(nftAddress: string, account: string): Promise<bigint> {
  const provider = createProvider();
  try {
    const nft = new Contract(nftAddress, SAMPLE_NFT_ABI, provider);
    return await nft.balanceOf(account);
  } finally {
    provider.destroy();
  }
}

/**
 * Get forwarder nonce for an account
 * @param forwarderAddress - Forwarder contract address
 * @param account - Account to check nonce for
 */
export async function getForwarderNonce(forwarderAddress: string, account: string): Promise<bigint> {
  const provider = createProvider();
  try {
    const forwarder = new Contract(forwarderAddress, FORWARDER_ABI, provider);
    return await forwarder.nonces(account);
  } finally {
    provider.destroy();
  }
}

/**
 * Encode ERC20 transfer call data
 */
export function encodeTokenTransfer(to: string, amount: bigint): string {
  const iface = new Interface(SAMPLE_TOKEN_ABI);
  return iface.encodeFunctionData('transfer', [to, amount]);
}

/**
 * Hardhat deployer account (Account #0)
 * This is a well-known development key - NEVER use in production
 */
export const HARDHAT_DEPLOYER = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
};

/**
 * Hardhat OZ Relayer account (Account #1)
 * This is a well-known development key - NEVER use in production
 */
export const HARDHAT_RELAYER = {
  address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
};

/**
 * Mint tokens directly using the deployer's private key
 * Used for test setup to pre-fund accounts before testing
 */
export async function mintTokensWithDeployer(
  tokenAddress: string,
  to: string,
  amount: bigint,
): Promise<string> {
  const provider = createProvider();
  try {
    const wallet = new ethers.Wallet(HARDHAT_DEPLOYER.privateKey, provider);
    const token = new Contract(tokenAddress, SAMPLE_TOKEN_ABI, wallet);
    const tx = await token.mint(to, amount);
    await tx.wait();
    return tx.hash;
  } finally {
    provider.destroy();
  }
}
