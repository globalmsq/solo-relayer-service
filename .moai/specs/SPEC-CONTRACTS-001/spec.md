---
id: SPEC-CONTRACTS-001
title: Smart Contracts Package and ERC2771Forwarder Deployment Scripts
domain: CONTRACTS
status: completed
priority: high
created_at: 2025-12-18
updated_at: 2025-12-18
version: 1.1.0
---

# SPEC-CONTRACTS-001: Smart Contracts Package and ERC2771Forwarder Deployment Scripts

## Overview

Initialize Hardhat-based smart contracts package (`packages/contracts`) with ERC2771Forwarder implementation using OpenZeppelin Contracts v5.3.0. Provide deployment scripts, test suites, and sample ERC20/ERC721 contracts demonstrating meta-transaction capabilities through ERC2771Context integration.

**Core Objective**: Enable meta-transaction infrastructure by deploying ERC2771Forwarder contract and providing reference implementations that showcase gasless transaction patterns.

## Objectives

1. **Hardhat Project Setup**: Initialize `packages/contracts` with Hardhat v2.22.0+ and TypeScript support
2. **ERC2771Forwarder Deployment**: Deploy OpenZeppelin's standard ERC2771Forwarder contract
3. **Sample Token Contracts**: Implement ERC20 and ERC721 contracts with ERC2771Context integration (localhost only)
4. **Deployment Scripts**: Create TypeScript-based deployment scripts with network detection
5. **Comprehensive Testing**: Unit tests for Forwarder, meta-transaction signature verification, and ERC2771Context integration
6. **Deployment Artifacts Management**: Save deployment addresses and ABIs to JSON files for API Gateway integration

---

## EARS Requirements

### Ubiquitous Requirements (System-wide)

**U-CONTRACTS-001**: The system shall use Hardhat as the smart contract development framework.

**U-CONTRACTS-002**: The system shall use OpenZeppelin Contracts v5.3.0 for all standard implementations (ERC2771Forwarder, ERC20, ERC721, ERC2771Context).

**U-CONTRACTS-003**: The system shall write all smart contracts in Solidity ^0.8.27.

**U-CONTRACTS-004**: The system shall place all contracts in `packages/contracts/contracts/` directory.

**U-CONTRACTS-005**: The system shall place all deployment scripts in `packages/contracts/scripts/` directory.

**U-CONTRACTS-006**: The system shall use TypeScript for all scripts and tests.

**U-CONTRACTS-007**: The system shall save deployment artifacts (addresses, ABIs, metadata) to `packages/contracts/deployments/` directory.

**U-CONTRACTS-008**: The system shall support both Hardhat Node (local) and Polygon Amoy Testnet deployment targets.

### Event-driven Requirements

**E-CONTRACTS-001**: When deployment script is executed, the system shall detect the target network (localhost or amoy) and deploy contracts accordingly.

**E-CONTRACTS-002**: When ERC2771Forwarder is deployed, the system shall verify the contract on block explorer (Polygon Amoy only).

**E-CONTRACTS-003**: When deployment completes successfully, the system shall save deployment information to `deployments/{network}/forwarder.json` file containing contract address, deployer address, transaction hash, block number, and timestamp.

**E-CONTRACTS-004**: When meta-transaction is executed, the system shall verify signature validity through ERC2771Forwarder's `verify()` function before execution.

**E-CONTRACTS-005**: When sample token contract receives meta-transaction, the system shall extract original sender (msg.sender) from calldata using ERC2771Context's `_msgSender()` override.

**E-CONTRACTS-006**: When sample token deployment script is executed, the system shall deploy SampleToken and SampleNFT only to localhost network (chainId: 31337).

**E-CONTRACTS-007**: When deployment script detects Polygon Amoy network (chainId: 80002), the system shall skip SampleToken and SampleNFT deployment and log a warning message.

### State-driven Requirements

**S-CONTRACTS-001**: While contracts are being compiled, the system shall generate TypeChain type definitions for TypeScript integration.

**S-CONTRACTS-002**: While tests are running, the system shall use Hardhat Network's automatic mining mode for deterministic test execution.

### Unwanted Behavior

**UW-CONTRACTS-001**: Private keys shall never be hardcoded in deployment scripts or test files.

**UW-CONTRACTS-002**: Deployment scripts shall not deploy contracts to mainnet without explicit network confirmation and safety checks.

**UW-CONTRACTS-003**: Sample contracts shall not be used in production environments without proper auditing and modifications.

### Optional Requirements

**O-CONTRACTS-001**: If possible, deployment scripts shall support gas estimation and price optimization.

**O-CONTRACTS-002**: If possible, tests shall include gas consumption reports for meta-transaction execution vs. direct transaction execution.

**O-CONTRACTS-003**: If possible, deployment scripts shall support multi-signature wallet deployment for production environments.

---

## Technical Specifications

### Project Structure

```
packages/contracts/
├── contracts/
│   ├── forwarder/
│   │   └── (Uses @openzeppelin/contracts/metatx/ERC2771Forwarder.sol directly)
│   ├── samples/
│   │   ├── SampleToken.sol          # ERC20 + ERC2771Context
│   │   └── SampleNFT.sol            # ERC721 + ERC2771Context (Optional)
│   └── interfaces/
│       └── IERC2771Forwarder.sol    # Interface for type-safe interactions
├── scripts/
│   ├── deploy-forwarder.ts          # ERC2771Forwarder deployment
│   ├── deploy-samples.ts            # Sample token deployments
│   └── utils/
│       ├── network.ts               # Network detection utilities
│       └── save-deployment.ts       # Deployment artifact management
├── test/
│   ├── ERC2771Forwarder.test.ts     # Forwarder deployment tests
│   ├── MetaTransaction.test.ts      # Signature verification tests
│   └── ERC2771Context.test.ts       # Integration tests
├── deployments/
│   ├── localhost/
│   │   └── forwarder.json
│   └── amoy/
│       └── forwarder.json
├── hardhat.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

### Hardhat Configuration

**hardhat.config.ts**:
```typescript
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "hardhat-gas-reporter";
import "solidity-coverage";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "paris",
    },
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    amoy: {
      url: process.env.POLYGON_AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      chainId: 80002,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      gasPrice: 35000000000, // 35 gwei
    },
  },
  etherscan: {
    apiKey: {
      polygonAmoy: process.env.POLYGONSCAN_API_KEY || "",
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

export default config;
```

### Contract Implementations

**SampleToken.sol (ERC20 + ERC2771Context)**:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

contract SampleToken is ERC20, ERC2771Context {
    constructor(
        address trustedForwarder,
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) ERC2771Context(trustedForwarder) {
        _mint(_msgSender(), initialSupply);
    }

    function _msgSender()
        internal
        view
        virtual
        override(Context, ERC2771Context)
        returns (address)
    {
        return ERC2771Context._msgSender();
    }

    function _msgData()
        internal
        view
        virtual
        override(Context, ERC2771Context)
        returns (bytes calldata)
    {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength()
        internal
        view
        virtual
        override(Context, ERC2771Context)
        returns (uint256)
    {
        return ERC2771Context._contextSuffixLength();
    }
}
```

**SampleNFT.sol (ERC721 + ERC2771Context) - Optional**:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract SampleNFT is ERC721, ERC2771Context, Ownable {
    uint256 private _tokenIdCounter;

    constructor(
        address trustedForwarder,
        string memory name,
        string memory symbol
    ) ERC721(name, symbol) ERC2771Context(trustedForwarder) Ownable(_msgSender()) {}

    function mint(address to) public {
        uint256 tokenId = _tokenIdCounter++;
        _safeMint(to, tokenId);
    }

    function _msgSender()
        internal
        view
        virtual
        override(Context, ERC2771Context)
        returns (address)
    {
        return ERC2771Context._msgSender();
    }

    function _msgData()
        internal
        view
        virtual
        override(Context, ERC2771Context)
        returns (bytes calldata)
    {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength()
        internal
        view
        virtual
        override(Context, ERC2771Context)
        returns (uint256)
    {
        return ERC2771Context._contextSuffixLength();
    }
}
```

### Deployment Scripts

**scripts/deploy-forwarder.ts**:
```typescript
import { ethers, network } from "hardhat";
import { saveDeployment } from "./utils/save-deployment";

async function main() {
  console.log(`Deploying ERC2771Forwarder to ${network.name}...`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer address: ${deployer.address}`);

  // Deploy ERC2771Forwarder
  const ERC2771Forwarder = await ethers.getContractFactory(
    "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol:ERC2771Forwarder"
  );
  const forwarder = await ERC2771Forwarder.deploy("MSQRelayerForwarder");

  await forwarder.waitForDeployment();
  const forwarderAddress = await forwarder.getAddress();

  console.log(`ERC2771Forwarder deployed to: ${forwarderAddress}`);

  // Save deployment info
  await saveDeployment(network.name, "forwarder", {
    address: forwarderAddress,
    deployer: deployer.address,
    transactionHash: forwarder.deploymentTransaction()?.hash || "",
    blockNumber: (await ethers.provider.getBlockNumber()),
    timestamp: Math.floor(Date.now() / 1000),
  });

  console.log(`Deployment info saved to deployments/${network.name}/forwarder.json`);

  // Verify on Polygon Amoy
  if (network.name === "amoy") {
    console.log("Waiting 30 seconds before verification...");
    await new Promise((resolve) => setTimeout(resolve, 30000));

    try {
      await hre.run("verify:verify", {
        address: forwarderAddress,
        constructorArguments: ["MSQRelayerForwarder"],
      });
      console.log("Contract verified on PolygonScan");
    } catch (error) {
      console.error("Verification failed:", error);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

**scripts/utils/save-deployment.ts**:
```typescript
import * as fs from "fs";
import * as path from "path";

interface DeploymentInfo {
  address: string;
  deployer: string;
  transactionHash: string;
  blockNumber: number;
  timestamp: number;
}

export async function saveDeployment(
  network: string,
  contractName: string,
  info: DeploymentInfo
): Promise<void> {
  const deploymentsDir = path.join(__dirname, "../..", "deployments", network);

  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentPath = path.join(deploymentsDir, `${contractName}.json`);

  const deploymentData = {
    ...info,
    network,
    contractName,
  };

  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentData, null, 2));
}
```

### Test Specifications

**test/ERC2771Forwarder.test.ts**:
```typescript
import { expect } from "chai";
import { ethers } from "hardhat";

describe("ERC2771Forwarder Deployment", function () {
  it("Should deploy ERC2771Forwarder successfully", async function () {
    const ERC2771Forwarder = await ethers.getContractFactory(
      "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol:ERC2771Forwarder"
    );
    const forwarder = await ERC2771Forwarder.deploy("MSQRelayerForwarder");
    await forwarder.waitForDeployment();

    const address = await forwarder.getAddress();
    expect(address).to.properAddress;
  });

  it("Should return correct forwarder name", async function () {
    // Implementation
  });
});
```

**test/MetaTransaction.test.ts**:
```typescript
import { expect } from "chai";
import { ethers } from "hardhat";

describe("Meta-Transaction Signature Verification", function () {
  let forwarder: any;
  let sampleToken: any;
  let signer: any;
  let relayer: any;

  beforeEach(async function () {
    [signer, relayer] = await ethers.getSigners();

    // Deploy Forwarder
    const ERC2771Forwarder = await ethers.getContractFactory(
      "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol:ERC2771Forwarder"
    );
    forwarder = await ERC2771Forwarder.deploy("MSQRelayerForwarder");

    // Deploy SampleToken
    const SampleToken = await ethers.getContractFactory("SampleToken");
    sampleToken = await SampleToken.deploy(
      await forwarder.getAddress(),
      "Sample Token",
      "SMPL",
      ethers.parseEther("1000")
    );
  });

  it("Should verify valid meta-transaction signature", async function () {
    // Create meta-transaction request
    // Sign with signer's private key
    // Verify signature through forwarder.verify()
    // Implementation
  });

  it("Should reject invalid signature", async function () {
    // Implementation
  });

  it("Should execute meta-transaction and extract correct msg.sender", async function () {
    // Implementation
  });
});
```

**test/ERC2771Context.test.ts**:
```typescript
import { expect } from "chai";
import { ethers } from "hardhat";

describe("ERC2771Context Integration", function () {
  it("Should extract original sender from meta-transaction", async function () {
    // Verify _msgSender() returns original user, not relayer
    // Implementation
  });

  it("Should work with direct transactions (non-meta)", async function () {
    // Verify _msgSender() returns msg.sender for direct calls
    // Implementation
  });
});
```

---

## Environment

### Development Environment
- **Hardhat**: v2.22.0+
- **Solidity**: ^0.8.27
- **TypeScript**: ^5.4.0
- **Node.js**: >=18.0.0
- **OpenZeppelin Contracts**: v5.3.0
- **Networks**:
  - Hardhat Node (localhost:8545, chainId: 31337)
  - Polygon Amoy Testnet (chainId: 80002)

### Production Environment (Phase 2+)
- **Network**: Polygon Mainnet
- **Deployment**: Multi-signature wallet recommended
- **Verification**: Polygon Mainnet block explorer

---

## Assumptions

1. **Hardhat Project Initialized**: `packages/contracts` directory exists with basic Hardhat setup (SPEC-MODULE-001 completed).
2. **OpenZeppelin Contracts**: v5.3.0 is the latest stable version for ERC2771Forwarder.
3. **Sample Contracts**: SampleToken and SampleNFT are for demonstration purposes only and require auditing before production use.
4. **Network Access**: Polygon Amoy RPC endpoint is accessible for testnet deployment.
5. **API Key Management**: PolygonScan API key is available for contract verification.

---

## Constraints

### Technical Constraints
- **Solidity Version**: ^0.8.27 (compatibility with OpenZeppelin Contracts v5.3.0)
- **OpenZeppelin Contracts**: Fixed at v5.3.0 (as specified in Task #7)
- **Hardhat Version**: ^2.22.0 (latest stable as of December 2025)
- **TypeScript**: Required for all scripts and tests

### Security Constraints
- **Private Key Management**: Private keys must be stored in `.env` file (excluded from Git)
- **Deployment Verification**: All Polygon Amoy deployments must be verified on PolygonScan
- **Contract Auditing**: Sample contracts must not be used in production without proper security audits

### Network Constraints
- **Gas Limits**: Polygon Amoy network gas limits apply
- **RPC Rate Limits**: Public RPC endpoints may have rate limiting
- **Transaction Costs**: Testnet MATIC required for Polygon Amoy deployment

---

## Dependencies

### External Dependencies
- **OpenZeppelin Contracts**: v5.3.0 (`@openzeppelin/contracts`)
- **Hardhat**: v2.22.0+ (`hardhat`)
- **Hardhat Toolbox**: v5.0.0+ (`@nomicfoundation/hardhat-toolbox`)
- **Hardhat Verify**: v2.0.0+ (`@nomicfoundation/hardhat-verify`)
- **TypeScript**: v5.4.0+ (`typescript`)
- **Ethers.js**: v6.x (via Hardhat Toolbox)

### Internal Dependencies
- **SPEC-MODULE-001**: NestJS module scaffolding (completed)
- **SPEC-INFRA-001**: Docker Compose infrastructure (completed, provides Hardhat Node)

### Network Dependencies
- **Hardhat Node**: Local blockchain (via Docker - SPEC-INFRA-001)
- **Polygon Amoy RPC**: Testnet deployment (public RPC or Alchemy/Infura)
- **PolygonScan API**: Contract verification

---

## Non-Functional Requirements

### Performance
- **Compilation Time**: < 10 seconds for full contract compilation
- **Test Execution Time**: < 30 seconds for complete test suite
- **Deployment Time**: < 2 minutes for Forwarder deployment (including verification)

### Reliability
- **Test Coverage**: >= 85% (TRUST 5 Framework requirement)
- **Deployment Success Rate**: >= 99% on stable networks
- **Type Safety**: 100% TypeScript type coverage for scripts

### Security
- **Contract Verification**: All deployed contracts must be verified on block explorer
- **Signature Validation**: 100% signature verification test coverage
- **Private Key Security**: Zero hardcoded private keys in codebase

### Maintainability
- **Code Documentation**: JSDoc comments for all public functions
- **Deployment Logs**: Structured JSON deployment artifacts for API Gateway integration
- **Error Handling**: Clear error messages for deployment failures

---

## Traceability

### Task Master Integration
- **Task ID**: `7` (Smart Contracts Package and ERC2771Forwarder Deployment Scripts)
- **Subtasks**:
  - `7.1`: Initialize Hardhat project with OpenZeppelin Contracts v5.3.0
  - `7.2`: Implement SampleToken (ERC20 + ERC2771Context)
  - `7.3`: Implement SampleNFT (ERC721 + ERC2771Context) - Optional
  - `7.4`: Create deployment scripts (deploy-forwarder.ts, deploy-samples.ts)
  - `7.5`: Write comprehensive test suite (Forwarder, MetaTransaction, ERC2771Context)
  - `7.6`: Configure Hardhat for Polygon Amoy and localhost networks
  - `7.7`: Implement deployment artifact management (save-deployment.ts)

### PRD Reference
- **PRD Section 4**: Smart contract layer with ERC2771Forwarder
- **PRD Section 6.2**: Meta-transaction signature and verification
- **PRD Section 7**: Project structure (packages/contracts/)

### Related SPECs
- **SPEC-INFRA-001**: Docker Compose infrastructure (provides Hardhat Node)
- **SPEC-MODULE-001**: NestJS module scaffolding (completed)

---

## Completion Checklist

- [ ] Hardhat project initialized in `packages/contracts/` with TypeScript support
- [ ] OpenZeppelin Contracts v5.3.0 installed
- [ ] SampleToken.sol (ERC20 + ERC2771Context) implemented
- [ ] SampleNFT.sol (ERC721 + ERC2771Context) implemented (Optional)
- [ ] deploy-forwarder.ts script created with network detection
- [ ] deploy-samples.ts script created
- [ ] save-deployment.ts utility implemented for artifact management
- [ ] ERC2771Forwarder.test.ts with deployment tests
- [ ] MetaTransaction.test.ts with signature verification tests
- [ ] ERC2771Context.test.ts with integration tests
- [ ] hardhat.config.ts configured for localhost and Polygon Amoy
- [ ] Test coverage >= 85% (TRUST 5 Framework)
- [ ] All contracts compile without errors
- [ ] All tests pass successfully
- [ ] Deployment artifacts saved to `deployments/{network}/` directory
- [ ] Contract verification working on Polygon Amoy
- [ ] README.md with setup and deployment instructions

---

## Version Information

- **SPEC Version**: 1.0.0
- **Created**: 2025-12-18
- **Last Updated**: 2025-12-18
- **Status**: Pending

---

## Change History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0.0 | 2025-12-18 | Initial draft (Hardhat setup, ERC2771Forwarder, deployment scripts, test suite) | manager-spec |
| 1.1.0 | 2025-12-18 | Add network restriction: SampleToken deployment limited to localhost only | manager-spec |
