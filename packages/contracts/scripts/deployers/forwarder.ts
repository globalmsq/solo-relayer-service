import { ethers } from "hardhat";

/**
 * Deploy ERC2771Forwarder contract
 * @returns Deployed contract address
 */
export async function deployForwarder(): Promise<string> {
  console.log("\nDeploying ERC2771Forwarder...");

  const Factory = await ethers.getContractFactory(
    "contracts/ERC2771Forwarder.sol:ERC2771Forwarder"
  );
  const contract = await Factory.deploy("MSQForwarder");
  await contract.waitForDeployment();

  const addr = await contract.getAddress();
  console.log(`✅ ERC2771Forwarder: ${addr}`);

  return addr;
}
