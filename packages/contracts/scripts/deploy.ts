import { ethers, network } from "hardhat";
import { deployForwarder, deploySampleToken, deploySampleNFT } from "./deployers";

// Environment variable-based deployment flags
// DEPLOY_FORWARDER: default true (required for meta-transactions)
// DEPLOY_SAMPLE_TOKEN: default false (development/testing only)
// DEPLOY_SAMPLE_NFT: default false (development/testing only)
const DEPLOY_FORWARDER = process.env.DEPLOY_FORWARDER !== "false";
const DEPLOY_SAMPLE_TOKEN = process.env.DEPLOY_SAMPLE_TOKEN === "true";
const DEPLOY_SAMPLE_NFT = process.env.DEPLOY_SAMPLE_NFT === "true";

async function main() {
  const chainId = network.config.chainId;
  const [deployer] = await ethers.getSigners();

  console.log("=".repeat(60));
  console.log("Contract Deployment");
  console.log("=".repeat(60));
  console.log(`Network: ${network.name} (chainId: ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(
    `Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`
  );
  console.log("=".repeat(60));
  console.log("Deploy Flags:");
  console.log(`  DEPLOY_FORWARDER: ${DEPLOY_FORWARDER}`);
  console.log(`  DEPLOY_SAMPLE_TOKEN: ${DEPLOY_SAMPLE_TOKEN}`);
  console.log(`  DEPLOY_SAMPLE_NFT: ${DEPLOY_SAMPLE_NFT}`);
  console.log("=".repeat(60));

  const deployed: Record<string, string> = {};

  // 1. Deploy Forwarder (required for meta-transactions)
  if (DEPLOY_FORWARDER) {
    deployed.forwarder = await deployForwarder();
  }

  // 2. Deploy SampleToken (requires Forwarder address)
  if (DEPLOY_SAMPLE_TOKEN) {
    if (!deployed.forwarder) {
      throw new Error(
        "SampleToken requires Forwarder. Set DEPLOY_FORWARDER=true or ensure Forwarder is deployed first."
      );
    }
    deployed.sampleToken = await deploySampleToken(deployed.forwarder);
  }

  // 3. Deploy SampleNFT (requires Forwarder address)
  if (DEPLOY_SAMPLE_NFT) {
    if (!deployed.forwarder) {
      throw new Error(
        "SampleNFT requires Forwarder. Set DEPLOY_FORWARDER=true or ensure Forwarder is deployed first."
      );
    }
    deployed.sampleNFT = await deploySampleNFT(deployed.forwarder);
  }

  // Deployment Summary
  console.log("\n" + "=".repeat(60));
  console.log("Deployment Summary");
  console.log("=".repeat(60));

  if (Object.keys(deployed).length === 0) {
    console.log("No contracts deployed. Check your DEPLOY_* environment variables.");
  } else {
    Object.entries(deployed).forEach(([name, addr]) => {
      console.log(`${name}: ${addr}`);
    });
  }

  console.log("\n✅ Deployment completed!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
