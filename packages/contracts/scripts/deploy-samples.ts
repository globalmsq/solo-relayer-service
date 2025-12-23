import { ethers, network } from "hardhat";

async function main() {
  // CRITICAL: SampleToken and SampleNFT should ONLY be deployed to development networks
  // Network Agnostic: Check chainId instead of network name
  const DEVELOPMENT_CHAIN_IDS = [31337];
  const currentChainId = network.config.chainId;

  if (!DEVELOPMENT_CHAIN_IDS.includes(currentChainId as number)) {
    throw new Error(
      `SampleToken and SampleNFT deployment is restricted to development networks (chainId: 31337). ` +
      `Current chainId: ${currentChainId}. These sample contracts are for testing only.`
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

  // Step 1: Deploy ERC2771Forwarder
  console.log("\nDeploying ERC2771Forwarder...");
  const ForwarderFactory = await ethers.getContractFactory("contracts/ERC2771Forwarder.sol:ERC2771Forwarder");
  const forwarder = await ForwarderFactory.deploy("MSQForwarder");
  await forwarder.waitForDeployment();
  const forwarderAddr = await forwarder.getAddress();
  console.log(`ERC2771Forwarder deployed to: ${forwarderAddr}`);

  // Step 2: Deploy SampleToken with forwarder address
  console.log("\nDeploying SampleToken...");
  const SampleTokenFactory = await ethers.getContractFactory("SampleToken");
  const sampleToken = await SampleTokenFactory.deploy(forwarderAddr);
  await sampleToken.waitForDeployment();
  const tokenAddr = await sampleToken.getAddress();
  console.log(`SampleToken deployed to: ${tokenAddr}`);

  // Verify initial supply
  const totalSupply = await sampleToken.totalSupply();
  console.log(`Initial supply: ${ethers.formatEther(totalSupply)} SMPL`);

  // Step 3: Deploy SampleNFT with forwarder address
  console.log("\nDeploying SampleNFT...");
  const SampleNFTFactory = await ethers.getContractFactory("SampleNFT");
  const sampleNFT = await SampleNFTFactory.deploy(forwarderAddr);
  await sampleNFT.waitForDeployment();
  const nftAddr = await sampleNFT.getAddress();
  console.log(`SampleNFT deployed to: ${nftAddr}`);

  console.log("\n" + "=".repeat(60));
  console.log("Deployment Summary");
  console.log("=".repeat(60));
  console.log(`ERC2771Forwarder: ${forwarderAddr}`);
  console.log(`SampleToken:      ${tokenAddr}`);
  console.log(`SampleNFT:        ${nftAddr}`);
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
