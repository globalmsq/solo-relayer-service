import { ethers, network } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("=".repeat(60));
  console.log("ERC2771 Forwarder Deployment");
  console.log("=".repeat(60));
  console.log(`Network: ${network.name}`);
  console.log(`Chain ID: ${network.config.chainId}`);
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  console.log("=".repeat(60));

  // Deploy ERC2771Forwarder
  console.log("\nDeploying ERC2771Forwarder...");
  const ForwarderFactory = await ethers.getContractFactory(
    "contracts/ERC2771Forwarder.sol:ERC2771Forwarder"
  );
  const forwarder = await ForwarderFactory.deploy("MSQForwarder");
  await forwarder.waitForDeployment();
  const forwarderAddr = await forwarder.getAddress();
  console.log(`ERC2771Forwarder deployed to: ${forwarderAddr}`);

  console.log("\n" + "=".repeat(60));
  console.log("Deployment Summary");
  console.log("=".repeat(60));
  console.log(`ERC2771Forwarder: ${forwarderAddr}`);
  console.log("\nDeployment completed successfully!");
  console.log("\nNext steps:");
  console.log(`1. Add to .env: FORWARDER_ADDRESS=${forwarderAddr}`);
  console.log("2. Use this address when deploying contracts that need meta-transaction support");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
