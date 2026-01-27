import { ethers } from "hardhat";

/**
 * Deploy SampleToken contract with trusted forwarder
 * @param forwarderAddr - Address of the deployed ERC2771Forwarder
 * @returns Deployed contract address
 */
export async function deploySampleToken(forwarderAddr: string): Promise<string> {
  console.log("\nDeploying SampleToken...");

  const Factory = await ethers.getContractFactory("SampleToken");
  const contract = await Factory.deploy(forwarderAddr);
  await contract.waitForDeployment();

  const addr = await contract.getAddress();
  console.log(`✅ SampleToken: ${addr}`);

  // Verify initial supply
  const totalSupply = await contract.totalSupply();
  console.log(`   Initial supply: ${ethers.formatEther(totalSupply)} SMPL`);

  return addr;
}
