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

  // Step 4: Mint tokens to OZ Relayer accounts for testing
  // These addresses match the keystores in docker/keys/relayer-{0,1,2}/
  // Using Hardhat Accounts #10, #11, #12
  // IMPORTANT: Minting AFTER all contract deployments to keep addresses deterministic
  const relayerAccounts = [
    "0xBcd4042DE499D14e55001CcbB24a551F3b954096",  // Account #10 (oz-relayer-0)
    "0x71bE63f3384f5fb98995898A86B02Fb2426c5788",  // Account #11 (oz-relayer-1)
    "0xFABB0ac9d68B0B445fB7357272Ff202C5651694a",  // Account #12 (oz-relayer-2)
  ];
  const mintAmount = ethers.parseEther("10000");  // 10,000 SMPL each

  console.log("\nMinting tokens to OZ Relayer accounts...");
  for (let i = 0; i < relayerAccounts.length; i++) {
    await sampleToken.mint(relayerAccounts[i], mintAmount);
    console.log(`  oz-relayer-${i} (${relayerAccounts[i]}): ${ethers.formatEther(mintAmount)} SMPL`);
  }

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
