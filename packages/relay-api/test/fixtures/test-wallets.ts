import { Wallet } from "ethers";

// Hardhat default accounts #0~#2 (well-known test wallets)
export const TEST_WALLETS = {
  relayer: new Wallet(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  ), // Account #0
  user: new Wallet(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  ), // Account #1
  merchant: new Wallet(
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  ), // Account #2
};

export const TEST_ADDRESSES = {
  relayer: TEST_WALLETS.relayer.address, // 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  user: TEST_WALLETS.user.address, // 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  merchant: TEST_WALLETS.merchant.address, // 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
};
