import { ethers, network } from "hardhat";

async function main() {
  // CRITICAL: SampleToken and SampleNFT should ONLY be deployed to localhost
  const allowedNetworks = ["hardhat", "localhost"];

  if (!allowedNetworks.includes(network.name)) {
    throw new Error(
      `SampleToken and SampleNFT deployment is restricted to localhost/hardhat networks. ` +
      `Current network: ${network.name}. Please use 'hardhat run scripts/deploy-samples.ts --network localhost'`
    );
  }

  const [deployer] = await ethers.getSigners();

  console.log("=".repeat(60));
  console.log("Sample Contracts Deployment (localhost only)");
  console.log("=".repeat(60));
  console.log(`Network: ${network.name}`);
  console.log(`Chain ID: ${network.config.chainId}`);
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  console.log("=".repeat(60));

  // Deploy SampleToken
  console.log("\nDeploying SampleToken...");
  const SampleTokenFactory = await ethers.getContractFactory("SampleToken");
  const sampleToken = await SampleTokenFactory.deploy(deployer.address);
  await sampleToken.waitForDeployment();
  const tokenAddr = await sampleToken.getAddress();
  console.log(`SampleToken deployed to: ${tokenAddr}`);

  // Verify initial supply
  const totalSupply = await sampleToken.totalSupply();
  console.log(`Initial supply: ${ethers.formatEther(totalSupply)} SMPL`);

  // Deploy SampleNFT
  console.log("\nDeploying SampleNFT...");
  const SampleNFTFactory = await ethers.getContractFactory("SampleNFT");
  const sampleNFT = await SampleNFTFactory.deploy(deployer.address);
  await sampleNFT.waitForDeployment();
  const nftAddr = await sampleNFT.getAddress();
  console.log(`SampleNFT deployed to: ${nftAddr}`);

  console.log("\n" + "=".repeat(60));
  console.log("Deployment Summary");
  console.log("=".repeat(60));
  console.log(`SampleToken:     ${tokenAddr}`);
  console.log(`SampleNFT:       ${nftAddr}`);
  console.log("\nDeployment completed successfully!");
  console.log("\nImportant Note:");
  console.log("- These contracts are deployed on LOCAL network only");
  console.log("- They are for testing and development purposes");
  console.log("- Do NOT use in production or on testnet/mainnet");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
