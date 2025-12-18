---
id: SPEC-CONTRACTS-001
title: Smart Contracts Package and ERC2771Forwarder Deployment Scripts - Implementation Plan
domain: CONTRACTS
status: pending
priority: high
created_at: 2025-12-18
updated_at: 2025-12-18
version: 1.1.0
---

# SPEC-CONTRACTS-001: Implementation Plan

## Overview

This plan outlines the implementation strategy for Smart Contracts Package and ERC2771Forwarder deployment scripts. The implementation follows a phased approach, starting with Hardhat project setup, contract development, deployment scripts, and comprehensive testing.

---

## Implementation Strategy

### Phase 1: Hardhat Project Setup and Configuration
**Priority**: High
**Dependencies**: SPEC-MODULE-001 (completed), SPEC-INFRA-001 (completed)

**Objectives**:
- Initialize Hardhat project with TypeScript support
- Install OpenZeppelin Contracts v5.3.0
- Configure Hardhat for localhost and Polygon Amoy networks
- Setup TypeChain for type-safe contract interactions

**Technical Approach**:

1. **Install Dependencies**:
```bash
cd packages/contracts
pnpm add -D hardhat@^2.22.0
pnpm add -D @nomicfoundation/hardhat-toolbox@^5.0.0
pnpm add -D @nomicfoundation/hardhat-verify@^2.0.0
pnpm add -D hardhat-gas-reporter@^2.0.0
pnpm add -D solidity-coverage@^0.8.0
pnpm add -D typescript@^5.4.0
pnpm add -D @types/node@^20.0.0
pnpm add @openzeppelin/contracts@5.3.0
```

2. **Configure hardhat.config.ts**:
- Solidity version: 0.8.27
- Optimizer enabled (200 runs)
- Networks: localhost (31337), amoy (80002)
- Etherscan API for verification
- TypeChain output configuration

3. **Create Environment Template**:
```bash
# .env.example
POLYGON_AMOY_RPC_URL=https://rpc-amoy.polygon.technology
DEPLOYER_PRIVATE_KEY=
POLYGONSCAN_API_KEY=
REPORT_GAS=false
COINMARKETCAP_API_KEY=
```

**Deliverables**:
- hardhat.config.ts with network configurations
- tsconfig.json for TypeScript support
- .env.example template
- package.json with scripts (compile, test, deploy)

**Risks**:
- OpenZeppelin Contracts v5.3.0 compatibility issues with Solidity 0.8.27
- Polygon Amoy RPC endpoint rate limiting

**Mitigation**:
- Use Context7 to verify OpenZeppelin v5.3.0 compatibility
- Fallback to Alchemy/Infura RPC for Polygon Amoy

---

### Phase 2: Contract Development
**Priority**: High
**Dependencies**: Phase 1 (Hardhat setup)

**Objectives**:
- Implement SampleToken (ERC20 + ERC2771Context)
- Implement SampleNFT (ERC721 + ERC2771Context) - Optional
- Create interface files for type-safe interactions
- Ensure proper ERC2771Context integration

**Technical Approach**:

1. **SampleToken.sol Implementation**:
- Inherit from OpenZeppelin's ERC20 and ERC2771Context
- Override `_msgSender()`, `_msgData()`, `_contextSuffixLength()` to prioritize ERC2771Context
- Constructor accepts trusted forwarder address, token name, symbol, and initial supply
- Mint initial supply to deployer (using `_msgSender()` for meta-transaction compatibility)

2. **SampleNFT.sol Implementation (Optional)**:
- Inherit from OpenZeppelin's ERC721, ERC2771Context, and Ownable
- Similar override pattern for context functions
- Implement `mint()` function for NFT creation
- Token ID counter for sequential minting

3. **Interface Files**:
```solidity
// contracts/interfaces/IERC2771Forwarder.sol
// Type-safe interface for ERC2771Forwarder interactions
interface IERC2771Forwarder {
    function verify(ForwardRequest calldata req, bytes calldata signature) external view returns (bool);
    function execute(ForwardRequest calldata req, bytes calldata signature) external payable;
}
```

**Deliverables**:
- contracts/samples/SampleToken.sol
- contracts/samples/SampleNFT.sol (Optional)
- contracts/interfaces/IERC2771Forwarder.sol
- Compiled artifacts and TypeChain types

**Risks**:
- Incorrect ERC2771Context override order causing msg.sender extraction failures
- Constructor parameter order mismatch with OpenZeppelin base contracts

**Mitigation**:
- Follow OpenZeppelin v5.3.0 official documentation for override patterns
- Write unit tests verifying `_msgSender()` behavior before deployment

---

### Phase 3: Deployment Scripts Development
**Priority**: High
**Dependencies**: Phase 2 (Contract development)

**Objectives**:
- Create deploy-forwarder.ts for ERC2771Forwarder deployment
- Create deploy-samples.ts for sample token deployments
- Implement save-deployment.ts utility for artifact management
- Support network detection (localhost vs. amoy)
- Implement contract verification for Polygon Amoy

**Technical Approach**:

1. **scripts/deploy-forwarder.ts**:
```typescript
// Network detection: hardhat.network.name
// Deploy ERC2771Forwarder with constructor arg: "MSQRelayerForwarder"
// Save deployment info to deployments/{network}/forwarder.json
// Verify on Polygon Amoy (if network === "amoy")
```

2. **scripts/deploy-samples.ts**:
```typescript
// Network detection: Exit early if not localhost
if (network.name !== "localhost" && network.name !== "hardhat") {
  console.log("⚠️  Skipping sample contract deployment on " + network.name);
  console.log("   Sample contracts only deploy to localhost for testing");
  return;
}
// Read forwarder address from deployments/{network}/forwarder.json
// Deploy SampleToken with forwarder address
// Deploy SampleNFT with forwarder address (Optional)
// Save deployment info for each contract
```

3. **scripts/utils/save-deployment.ts**:
```typescript
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
): Promise<void>;
```

4. **Network Detection Utility** (scripts/utils/network.ts):
```typescript
export function isLocalNetwork(): boolean {
  return network.name === "localhost" || network.name === "hardhat";
}

export function isTestnet(): boolean {
  return network.name === "amoy";
}
```

**Deliverables**:
- scripts/deploy-forwarder.ts
- scripts/deploy-samples.ts
- scripts/utils/save-deployment.ts
- scripts/utils/network.ts
- deployments/ directory with network subdirectories

**Risks**:
- Polygon Amoy verification API rate limiting or downtime
- Deployment transaction failures due to insufficient gas or nonce issues
- Incorrect deployment artifact format for API Gateway integration

**Mitigation**:
- Implement retry logic for verification (with exponential backoff)
- Use Hardhat's built-in nonce management
- Define deployment artifact schema in coordination with API Gateway team

---

### Phase 4: Test Suite Development
**Priority**: High
**Dependencies**: Phase 2 (Contract development), Phase 3 (Deployment scripts)

**Objectives**:
- Write unit tests for ERC2771Forwarder deployment
- Write integration tests for meta-transaction signature verification
- Write tests for ERC2771Context integration
- Achieve >= 85% test coverage (TRUST 5 Framework)

**Technical Approach**:

1. **test/ERC2771Forwarder.test.ts**:
```typescript
describe("ERC2771Forwarder Deployment", () => {
  it("Should deploy successfully");
  it("Should return correct forwarder name");
  it("Should have correct domain separator");
});
```

2. **test/MetaTransaction.test.ts**:
```typescript
describe("Meta-Transaction Signature Verification", () => {
  it("Should verify valid signature");
  it("Should reject invalid signature");
  it("Should reject expired nonce");
  it("Should execute meta-transaction and emit event");
  it("Should extract correct msg.sender from meta-tx");
});
```

3. **test/ERC2771Context.test.ts**:
```typescript
describe("ERC2771Context Integration", () => {
  it("Should extract original sender from meta-transaction");
  it("Should work with direct transactions (non-meta)");
  it("Should handle edge case: empty calldata suffix");
});
```

4. **Gas Consumption Reporting** (Optional):
```typescript
// Compare gas usage: meta-transaction vs. direct transaction
it("Should report gas savings for batched meta-transactions");
```

**Deliverables**:
- test/ERC2771Forwarder.test.ts
- test/MetaTransaction.test.ts
- test/ERC2771Context.test.ts
- Test coverage report (>= 85%)

**Risks**:
- Signature verification logic mismatch with ERC2771Forwarder implementation
- Hardhat Network's automatic mining interfering with nonce management tests
- Insufficient test coverage for edge cases

**Mitigation**:
- Reference OpenZeppelin's official test suite for ERC2771Forwarder
- Use Hardhat's `evm_mine` and `evm_setNextBlockTimestamp` for deterministic testing
- Use `hardhat coverage` to identify untested code paths

---

### Phase 5: Integration and Verification
**Priority**: Medium
**Dependencies**: All previous phases

**Objectives**:
- Deploy to Hardhat Node (localhost) and verify functionality
- Deploy to Polygon Amoy Testnet and verify on PolygonScan
- Validate deployment artifacts format for API Gateway integration
- Document deployment process in README.md

**Technical Approach**:

1. **Localhost Deployment**:
```bash
# Start Hardhat Node (via Docker - SPEC-INFRA-001)
docker-compose up hardhat-node

# Deploy contracts
pnpm run deploy:local
```

2. **Polygon Amoy Deployment**:
```bash
# Set environment variables in .env
POLYGON_AMOY_RPC_URL=...
DEPLOYER_PRIVATE_KEY=...
POLYGONSCAN_API_KEY=...

# Deploy and verify
pnpm run deploy:amoy
```

3. **Deployment Artifact Validation**:
```json
// deployments/amoy/forwarder.json
{
  "address": "0x...",
  "deployer": "0x...",
  "transactionHash": "0x...",
  "blockNumber": 12345,
  "timestamp": 1734518400,
  "network": "amoy",
  "contractName": "forwarder"
}
```

4. **README.md Documentation**:
- Installation instructions
- Environment setup guide
- Deployment commands
- Testing commands
- Contract verification steps

**Deliverables**:
- Successful localhost deployment
- Verified Polygon Amoy deployment
- deployments/localhost/ and deployments/amoy/ artifacts
- README.md with comprehensive documentation

**Risks**:
- Polygon Amoy network congestion causing deployment delays
- PolygonScan verification failures due to constructor argument mismatch
- API Gateway unable to parse deployment artifacts

**Mitigation**:
- Monitor Polygon Amoy network status before deployment
- Double-check constructor arguments in verification script
- Coordinate deployment artifact schema with API Gateway team

---

## Technical Architecture

### Contract Inheritance Hierarchy

```
SampleToken (ERC20 + ERC2771Context)
├── ERC20 (OpenZeppelin)
├── ERC2771Context (OpenZeppelin)
└── Context (OpenZeppelin) - overridden by ERC2771Context

SampleNFT (ERC721 + ERC2771Context + Ownable)
├── ERC721 (OpenZeppelin)
├── ERC2771Context (OpenZeppelin)
├── Ownable (OpenZeppelin)
└── Context (OpenZeppelin) - overridden by ERC2771Context
```

### Deployment Workflow

```
1. Deploy ERC2771Forwarder
   ├── Constructor: "MSQRelayerForwarder"
   └── Save address to deployments/{network}/forwarder.json

2. Deploy SampleToken
   ├── Read forwarder address from deployments/{network}/forwarder.json
   ├── Constructor: (forwarderAddress, "Sample Token", "SMPL", 1000 ether)
   └── Save address to deployments/{network}/sample-token.json

3. Deploy SampleNFT (Optional)
   ├── Read forwarder address from deployments/{network}/forwarder.json
   ├── Constructor: (forwarderAddress, "Sample NFT", "SNFT")
   └── Save address to deployments/{network}/sample-nft.json

4. Verify on Block Explorer (Polygon Amoy only)
   └── Use hardhat-verify plugin
```

### Meta-Transaction Flow (for testing)

```
1. User creates ForwardRequest
   ├── from: user address
   ├── to: target contract (SampleToken)
   ├── value: 0
   ├── gas: estimated gas
   ├── nonce: user's current nonce from Forwarder
   ├── deadline: current timestamp + 300 seconds
   └── data: ABI-encoded function call

2. User signs ForwardRequest
   └── EIP-712 typed data signature

3. Relayer receives request and signature
   └── Calls forwarder.verify(request, signature)

4. Forwarder validates signature
   └── Checks: signature valid, nonce unused, deadline not passed

5. Forwarder executes transaction
   ├── Calls target contract with appended sender address
   └── Target contract uses ERC2771Context._msgSender() to extract original sender

6. Target contract executes business logic
   └── Uses original sender (not relayer address) for authorization
```

---

## Quality Assurance

### Testing Strategy

1. **Unit Tests** (test/ERC2771Forwarder.test.ts):
   - Deployment validation
   - Constructor parameter verification
   - Domain separator calculation

2. **Integration Tests** (test/MetaTransaction.test.ts):
   - Valid signature verification
   - Invalid signature rejection
   - Nonce replay protection
   - Deadline expiration handling
   - Event emission verification

3. **Context Tests** (test/ERC2771Context.test.ts):
   - Meta-transaction sender extraction
   - Direct transaction sender handling
   - Calldata suffix parsing edge cases

4. **Coverage Requirements**:
   - Target: >= 85% (TRUST 5 Framework)
   - Command: `pnpm run test:coverage`
   - Report: coverage/index.html

### Deployment Validation

1. **Localhost Validation**:
   - Deploy to Hardhat Node
   - Execute meta-transaction test
   - Verify `_msgSender()` returns correct address

2. **Polygon Amoy Validation**:
   - Deploy with testnet MATIC
   - Verify on PolygonScan
   - Execute meta-transaction on testnet
   - Validate deployment artifacts

---

## Risks and Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| OpenZeppelin v5.3.0 API changes | High | Low | Use Context7 for latest documentation |
| Polygon Amoy RPC rate limits | Medium | Medium | Use Alchemy/Infura premium tier |
| Insufficient test coverage | High | Low | Use `solidity-coverage` plugin |
| PolygonScan verification failures | Medium | Medium | Retry with exponential backoff |
| Incorrect ERC2771Context override | High | Low | Follow OpenZeppelin official examples |
| Deployment artifact schema mismatch | Medium | Low | Coordinate with API Gateway team |

---

## Timeline Estimates

**Note**: Following TRUST 5 Framework principles, time estimates are provided as priority-based milestones, not absolute deadlines.

### Primary Goals (High Priority)
1. **Phase 1**: Hardhat setup and configuration
2. **Phase 2**: Contract development (SampleToken required)
3. **Phase 3**: Deployment scripts (deploy-forwarder.ts required)
4. **Phase 4**: Test suite (>= 85% coverage required)

### Secondary Goals (Medium Priority)
5. **Phase 5**: Integration and verification
6. **Optional**: SampleNFT implementation
7. **Optional**: Gas consumption reporting

### Final Goals (Low Priority)
8. **Documentation**: README.md enhancement
9. **Optional**: Multi-signature wallet deployment support

---

## Success Criteria

- [x] Hardhat project compiles without errors
- [x] OpenZeppelin Contracts v5.3.0 installed
- [x] SampleToken implements ERC2771Context correctly
- [x] Deployment scripts support localhost and Polygon Amoy
- [x] Test coverage >= 85%
- [x] All tests pass successfully
- [x] Deployment artifacts saved in correct format
- [x] Contracts verified on PolygonScan (Polygon Amoy)
- [x] README.md includes deployment instructions

---

## Dependencies

### External Dependencies
- **@openzeppelin/contracts@5.3.0**: ERC2771Forwarder, ERC20, ERC721, ERC2771Context
- **hardhat@^2.22.0**: Smart contract development framework
- **@nomicfoundation/hardhat-toolbox@^5.0.0**: Comprehensive Hardhat plugin suite
- **ethers@^6.x**: Ethereum library (via Hardhat Toolbox)

### Internal Dependencies
- **SPEC-MODULE-001**: NestJS module scaffolding (provides project structure)
- **SPEC-INFRA-001**: Docker Compose infrastructure (provides Hardhat Node)

### Network Dependencies
- **Hardhat Node**: Docker container (localhost:8545) from SPEC-INFRA-001
- **Polygon Amoy RPC**: Public endpoint or Alchemy/Infura
- **PolygonScan API**: Contract verification service

---

## Next Steps After Completion

1. **API Gateway Integration**:
   - Import deployment artifacts from `deployments/` directory
   - Configure API Gateway to use deployed ERC2771Forwarder address
   - Implement meta-transaction relay endpoints

2. **SDK Development** (Future SPEC):
   - TypeScript SDK for meta-transaction creation
   - Signature generation utilities
   - Forwarder interaction helpers

3. **Monitoring Integration**:
   - Track meta-transaction success rates
   - Monitor gas savings vs. direct transactions
   - Alert on Forwarder nonce desync issues

4. **Production Deployment** (Phase 2+):
   - Multi-signature wallet deployment
   - Polygon Mainnet deployment and verification
   - Security audit for sample contracts (if used in production)

---

## Version Information

- **Plan Version**: 1.0.0
- **Created**: 2025-12-18
- **Last Updated**: 2025-12-18
- **Status**: Pending

---

## Change History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0.0 | 2025-12-18 | Initial implementation plan (5 phases, testing strategy, deployment workflow) | manager-spec |
