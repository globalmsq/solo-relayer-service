import fs from "fs";
import path from "path";

export interface DeploymentRecord {
  network: string;
  timestamp: string;
  deployer: string;
  contracts: {
    [contractName: string]: {
      address: string;
      args: any[];
    };
  };
}

export function saveDeployment(
  networkName: string,
  deployer: string,
  contracts: Record<string, { address: string; args: any[] }>
): string {
  const deploymentDir = path.join(__dirname, "../../deployments");

  // Create deployments directory if it doesn't exist
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  const record: DeploymentRecord = {
    network: networkName,
    timestamp: new Date().toISOString(),
    deployer,
    contracts,
  };

  const filename = `${networkName}-${Date.now()}.json`;
  const filepath = path.join(deploymentDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(record, null, 2));

  return filepath;
}

export function loadDeployment(networkName: string): DeploymentRecord | null {
  const deploymentDir = path.join(__dirname, "../../deployments");

  if (!fs.existsSync(deploymentDir)) {
    return null;
  }

  const files = fs
    .readdirSync(deploymentDir)
    .filter((f) => f.startsWith(networkName))
    .sort()
    .reverse();

  if (files.length === 0) {
    return null;
  }

  const content = fs.readFileSync(path.join(deploymentDir, files[0]), "utf-8");
  return JSON.parse(content);
}

export function formatDeploymentRecord(record: DeploymentRecord): string {
  const lines: string[] = [];

  lines.push(`Network: ${record.network}`);
  lines.push(`Timestamp: ${record.timestamp}`);
  lines.push(`Deployer: ${record.deployer}`);
  lines.push("\nContracts:");

  for (const [name, info] of Object.entries(record.contracts)) {
    lines.push(`  ${name}:`);
    lines.push(`    Address: ${info.address}`);
    if (info.args.length > 0) {
      lines.push(`    Args: ${JSON.stringify(info.args)}`);
    }
  }

  return lines.join("\n");
}
