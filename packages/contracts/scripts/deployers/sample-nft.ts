import { ethers } from "hardhat";

/**
 * Deploy SampleNFT contract with trusted forwarder
 * @param forwarderAddr - Address of the deployed ERC2771Forwarder
 * @returns Deployed contract address
 */
export async function deploySampleNFT(forwarderAddr: string): Promise<string> {
  console.log("\nDeploying SampleNFT...");

  const Factory = await ethers.getContractFactory("SampleNFT");
  const contract = await Factory.deploy(forwarderAddr);
  await contract.waitForDeployment();

  const addr = await contract.getAddress();
  console.log(`✅ SampleNFT: ${addr}`);

  return addr;
}
