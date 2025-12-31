import { Interface } from "ethers";

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) public returns (bool)",
];

export function encodeERC20Transfer(to: string, amount: string): string {
  const iface = new Interface(ERC20_ABI);
  return iface.encodeFunctionData("transfer", [to, amount]);
}
