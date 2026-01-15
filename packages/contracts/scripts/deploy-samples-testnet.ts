import { ethers, network } from "hardhat";

/**
 * Deployment script for SampleToken and SampleNFT on testnets.
 *
 * Prerequisites:
 * - FORWARDER_ADDRESS must be set in environment (existing ERC2771Forwarder)
 * - PRIVATE_KEY must be set for deployer account
 * - Deployer must have sufficient native tokens for gas
 *
 * Usage:
 *   pnpm hardhat run scripts/deploy-samples-testnet.ts --network external
 */
async function main() {
  const forwarderAddress = process.env.FORWARDER_ADDRESS;

  if (!forwarderAddress) {
    throw new Error(
      "FORWARDER_ADDRESS environment variable is required. " +
        "Set it to the deployed ERC2771Forwarder address."
    );
  }

  // Validate forwarder address format
  if (!ethers.isAddress(forwarderAddress)) {
    throw new Error(`Invalid FORWARDER_ADDRESS: ${forwarderAddress}`);
  }

  const [deployer] = await ethers.getSigners();

  console.log("=".repeat(60));
  console.log("Sample Contracts Deployment (Testnet)");
  console.log("=".repeat(60));
  console.log(`Network: ${network.name}`);
  console.log(`Chain ID: ${network.config.chainId}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Forwarder: ${forwarderAddress}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH/MATIC`);
  console.log("=".repeat(60));

  // Verify forwarder contract exists
  console.log("\nVerifying ERC2771Forwarder...");
  const forwarderCode = await ethers.provider.getCode(forwarderAddress);
  if (forwarderCode === "0x") {
    throw new Error(
      `No contract found at FORWARDER_ADDRESS: ${forwarderAddress}`
    );
  }
  console.log("ERC2771Forwarder verified.");

  // Step 1: Deploy SampleToken with forwarder address
  console.log("\nDeploying SampleToken...");
  const SampleTokenFactory = await ethers.getContractFactory("SampleToken");
  const sampleToken = await SampleTokenFactory.deploy(forwarderAddress);
  await sampleToken.waitForDeployment();
  const tokenAddr = await sampleToken.getAddress();
  console.log(`SampleToken deployed to: ${tokenAddr}`);

  // Verify initial supply
  const totalSupply = await sampleToken.totalSupply();
  console.log(`Initial supply: ${ethers.formatEther(totalSupply)} SMPL`);

  // Verify trusted forwarder
  const tokenForwarder = await sampleToken.getTrustedForwarder();
  console.log(`Trusted Forwarder: ${tokenForwarder}`);

  // Step 2: Deploy SampleNFT with forwarder address
  console.log("\nDeploying SampleNFT...");
  const SampleNFTFactory = await ethers.getContractFactory("SampleNFT");
  const sampleNFT = await SampleNFTFactory.deploy(forwarderAddress);
  await sampleNFT.waitForDeployment();
  const nftAddr = await sampleNFT.getAddress();
  console.log(`SampleNFT deployed to: ${nftAddr}`);

  // Verify trusted forwarder
  const nftForwarder = await sampleNFT.getTrustedForwarder();
  console.log(`Trusted Forwarder: ${nftForwarder}`);

  console.log("\n" + "=".repeat(60));
  console.log("Deployment Summary");
  console.log("=".repeat(60));
  console.log(`ERC2771Forwarder: ${forwarderAddress}`);
  console.log(`SampleToken:      ${tokenAddr}`);
  console.log(`SampleNFT:        ${nftAddr}`);
  console.log("\nDeployment completed successfully!");

  console.log("\n" + "=".repeat(60));
  console.log("Next Steps");
  console.log("=".repeat(60));
  console.log("1. Update deployments/polygon-amoy.json with:");
  console.log(`   "SampleToken": { "address": "${tokenAddr}" }`);
  console.log(`   "SampleNFT": { "address": "${nftAddr}" }`);
  console.log("\n2. Update integration-tests/.env.amoy with:");
  console.log(`   SAMPLE_TOKEN_ADDRESS=${tokenAddr}`);
  console.log(`   SAMPLE_NFT_ADDRESS=${nftAddr}`);
  console.log("\n3. Verify contracts on Polygonscan:");
  console.log(
    `   pnpm hardhat verify --network external ${tokenAddr} ${forwarderAddress}`
  );
  console.log(
    `   pnpm hardhat verify --network external ${nftAddr} ${forwarderAddress}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
