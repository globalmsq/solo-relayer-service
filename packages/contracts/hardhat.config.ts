import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "hardhat-gas-reporter";
import "solidity-coverage";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const RPC_URL = process.env.RPC_URL || "http://localhost:8545";
const CHAIN_ID = parseInt(process.env.CHAIN_ID || "31337", 10);
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

// Helper function to check if PRIVATE_KEY is valid (64 hex chars or 66 with 0x prefix)
function isValidPrivateKey(key: string): boolean {
  if (!key) return false;
  const cleanKey = key.startsWith("0x") ? key.slice(2) : key;
  return /^[0-9a-fA-F]{64}$/.test(cleanKey);
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "paris",
    },
  },
  networks: {
    // In-memory Hardhat network (default for testing)
    hardhat: {
      chainId: 31337,
      accounts: {
        count: 20,
        accountsBalance: "10000000000000000000000", // 10,000 ETH
      },
    },
    // External network (localhost, Amoy, or any network)
    // Network Agnostic: Set RPC_URL and CHAIN_ID for any network
    // - Hardhat node: RPC_URL=http://localhost:8545 CHAIN_ID=31337
    // - Docker node: RPC_URL=http://hardhat-node:8545 CHAIN_ID=31337
    // - Amoy testnet: RPC_URL=https://rpc-amoy.polygon.technology CHAIN_ID=80002
    external: {
      url: RPC_URL,
      chainId: CHAIN_ID,
      accounts: isValidPrivateKey(PRIVATE_KEY) ? [PRIVATE_KEY] : [],
      gasPrice: "auto",
    },
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
    customChains: [
      {
        network: "external",
        chainId: 80002,
        urls: {
          apiURL: "https://api-amoy.polygonscan.com/api",
          browserURL: "https://amoy.polygonscan.com",
        },
      },
    ],
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    gasPrice: 30,
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

export default config;
