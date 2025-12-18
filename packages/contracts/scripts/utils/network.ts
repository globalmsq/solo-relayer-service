import { Network } from "ethers";
import { HardhatNetworkConfig } from "hardhat/types";

export interface NetworkConfig {
  name: string;
  chainId: number;
  rpcUrl?: string;
  isLocal: boolean;
  isTestnet: boolean;
}

export function getNetworkConfig(
  networkName: string,
  hardhatConfig: any
): NetworkConfig {
  const networkCfg = hardhatConfig.networks[networkName];

  const isLocal = ["hardhat", "localhost"].includes(networkName);
  const isTestnet = ["amoy", "sepolia", "goerli"].includes(networkName);

  return {
    name: networkName,
    chainId: networkCfg?.chainId || 31337,
    rpcUrl: networkCfg?.url,
    isLocal,
    isTestnet,
  };
}

export function validateNetwork(
  networkName: string,
  allowedNetworks: string[]
): void {
  if (!allowedNetworks.includes(networkName)) {
    throw new Error(
      `Network '${networkName}' is not allowed. Allowed networks: ${allowedNetworks.join(", ")}`
    );
  }
}

export function formatNetworkInfo(config: NetworkConfig): string {
  return `
Network: ${config.name}
Chain ID: ${config.chainId}
Type: ${config.isLocal ? "Local" : config.isTestnet ? "Testnet" : "Mainnet"}
RPC URL: ${config.rpcUrl || "N/A"}
  `.trim();
}
