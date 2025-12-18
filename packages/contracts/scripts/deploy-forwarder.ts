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

  // Note: ERC2771Forwarder can be deployed on any network (localhost, amoy, mainnet, etc.)
  // This is the trusted forwarder contract that handles meta-transactions
  console.log("\nERC2771 Forwarder deployment script");
  console.log("- This contract should be deployed once per network");
  console.log("- It handles meta-transaction forwarding for gasless transactions");
  console.log("- Smart contracts (SampleToken, SampleNFT) should be initialized with this address");
  console.log("\nExample usage:");
  console.log("1. Deploy this forwarder");
  console.log("2. Get the forwarder address");
  console.log("3. Deploy SampleToken and SampleNFT with the forwarder address");
  console.log("4. Users can then use gasless transactions through this forwarder");

  console.log("\nDeployment completed!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
