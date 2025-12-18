---
id: SPEC-CONTRACTS-001
title: Smart Contracts Package and ERC2771Forwarder Deployment Scripts - Acceptance Criteria
domain: CONTRACTS
status: pending
priority: high
created_at: 2025-12-18
updated_at: 2025-12-18
version: 1.1.0
---

# SPEC-CONTRACTS-001: Acceptance Criteria

## Overview

This document defines the acceptance criteria for Smart Contracts Package and ERC2771Forwarder deployment scripts implementation. All criteria must be met before marking this SPEC as completed.

---

## Functional Acceptance Criteria

### AC-1: Hardhat Project Setup and Configuration

**Given** a clean `packages/contracts` directory
**When** the project is initialized with Hardhat and dependencies
**Then** the following conditions must be satisfied:

- [ ] `hardhat.config.ts` exists with Solidity 0.8.27 configuration
- [ ] `tsconfig.json` exists with proper TypeScript settings
- [ ] `.env.example` template exists with all required environment variables
- [ ] `package.json` includes scripts: `compile`, `test`, `test:coverage`, `deploy:local`, `deploy:amoy`
- [ ] OpenZeppelin Contracts v5.3.0 is installed
- [ ] Hardhat Toolbox v5.0.0+ is installed
- [ ] TypeScript v5.4.0+ is installed
- [ ] Running `pnpm run compile` compiles all contracts successfully
- [ ] TypeChain types are generated in `typechain-types/` directory

**Verification Method**:
```bash
cd packages/contracts
pnpm run compile
ls -la typechain-types/
```

---

### AC-2: SampleToken Contract Implementation

**Given** OpenZeppelin Contracts v5.3.0 is installed
**When** SampleToken contract is implemented
**Then** the following conditions must be satisfied:

- [ ] `contracts/samples/SampleToken.sol` exists
- [ ] Contract inherits from `ERC20` and `ERC2771Context`
- [ ] Constructor accepts: `trustedForwarder`, `name`, `symbol`, `initialSupply`
- [ ] `_msgSender()` is overridden to prioritize `ERC2771Context._msgSender()`
- [ ] `_msgData()` is overridden to prioritize `ERC2771Context._msgData()`
- [ ] `_contextSuffixLength()` is overridden to prioritize `ERC2771Context._contextSuffixLength()`
- [ ] Initial supply is minted to `_msgSender()` (not `msg.sender`)
- [ ] Contract compiles without warnings or errors

**Verification Method**:
```bash
pnpm run compile
# Check for compilation warnings
```

**Test Case**:
```typescript
describe("SampleToken", () => {
  it("Should deploy with correct parameters", async () => {
    const token = await SampleToken.deploy(forwarderAddress, "Test", "TST", 1000);
    expect(await token.name()).to.equal("Test");
    expect(await token.symbol()).to.equal("TST");
    expect(await token.totalSupply()).to.equal(1000);
  });

  it("Should mint initial supply to deployer", async () => {
    const [deployer] = await ethers.getSigners();
    const token = await SampleToken.deploy(forwarderAddress, "Test", "TST", 1000);
    expect(await token.balanceOf(deployer.address)).to.equal(1000);
  });
});
```

---

### AC-3: SampleNFT Contract Implementation (Optional)

**Given** OpenZeppelin Contracts v5.3.0 is installed
**When** SampleNFT contract is implemented
**Then** the following conditions must be satisfied:

- [ ] `contracts/samples/SampleNFT.sol` exists
- [ ] Contract inherits from `ERC721`, `ERC2771Context`, and `Ownable`
- [ ] Constructor accepts: `trustedForwarder`, `name`, `symbol`
- [ ] `_msgSender()` is overridden to prioritize `ERC2771Context._msgSender()`
- [ ] `_msgData()` is overridden to prioritize `ERC2771Context._msgData()`
- [ ] `_contextSuffixLength()` is overridden to prioritize `ERC2771Context._contextSuffixLength()`
- [ ] `mint()` function increments token ID counter and mints to specified address
- [ ] Contract compiles without warnings or errors

**Verification Method**:
```bash
pnpm run compile
```

**Test Case**:
```typescript
describe("SampleNFT", () => {
  it("Should deploy with correct parameters", async () => {
    const nft = await SampleNFT.deploy(forwarderAddress, "TestNFT", "TNFT");
    expect(await nft.name()).to.equal("TestNFT");
    expect(await nft.symbol()).to.equal("TNFT");
  });

  it("Should mint NFT with sequential token IDs", async () => {
    const nft = await SampleNFT.deploy(forwarderAddress, "TestNFT", "TNFT");
    await nft.mint(user.address);
    expect(await nft.ownerOf(0)).to.equal(user.address);
  });
});
```

---

### AC-4: ERC2771Forwarder Deployment Script

**Given** Hardhat is configured for localhost and Polygon Amoy networks
**When** `scripts/deploy-forwarder.ts` is executed
**Then** the following conditions must be satisfied:

- [ ] Script detects current network (localhost or amoy)
- [ ] ERC2771Forwarder is deployed with constructor arg "MSQRelayerForwarder"
- [ ] Deployment transaction is confirmed
- [ ] Deployment info is saved to `deployments/{network}/forwarder.json`
- [ ] JSON file includes: `address`, `deployer`, `transactionHash`, `blockNumber`, `timestamp`
- [ ] On Polygon Amoy: Contract is verified on PolygonScan
- [ ] Script logs deployment address and transaction hash
- [ ] Script exits with code 0 on success

**Verification Method**:
```bash
# Localhost deployment
pnpm run deploy:local
cat deployments/localhost/forwarder.json

# Polygon Amoy deployment
pnpm run deploy:amoy
cat deployments/amoy/forwarder.json
```

**Expected Output**:
```json
{
  "address": "0x1234567890abcdef1234567890abcdef12345678",
  "deployer": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  "transactionHash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  "blockNumber": 12345,
  "timestamp": 1734518400,
  "network": "localhost",
  "contractName": "forwarder"
}
```

---

### AC-5: Sample Contracts Deployment Script

**Given** ERC2771Forwarder is deployed to target network
**When** `scripts/deploy-samples.ts` is executed
**Then** the following conditions must be satisfied:

- [ ] Script reads forwarder address from `deployments/{network}/forwarder.json`
- [ ] SampleToken is deployed with forwarder address, "Sample Token", "SMPL", 1000 ether
- [ ] SampleNFT is deployed with forwarder address, "Sample NFT", "SNFT" (Optional)
- [ ] Deployment info is saved to `deployments/{network}/sample-token.json`
- [ ] Deployment info is saved to `deployments/{network}/sample-nft.json` (Optional)
- [ ] Script logs deployment addresses
- [ ] Script exits with code 0 on success

**Verification Method**:
```bash
pnpm run deploy:local
# Or
pnpm run deploy:amoy
```

---

### AC-6: Deployment Artifact Management

**Given** contracts are deployed to target network
**When** deployment completes successfully
**Then** the following conditions must be satisfied:

- [ ] `deployments/` directory exists
- [ ] `deployments/{network}/` subdirectory exists for each network (localhost, amoy)
- [ ] Each deployment JSON file includes required fields: `address`, `deployer`, `transactionHash`, `blockNumber`, `timestamp`, `network`, `contractName`
- [ ] JSON files are properly formatted (valid JSON with 2-space indentation)
- [ ] Timestamps are in Unix epoch seconds
- [ ] Block numbers are valid integers

**Verification Method**:
```bash
cat deployments/localhost/forwarder.json | jq .
cat deployments/amoy/sample-token.json | jq .
```

---

### AC-7: Meta-Transaction Signature Verification Tests

**Given** ERC2771Forwarder and SampleToken are deployed
**When** meta-transaction signature verification tests are executed
**Then** the following conditions must be satisfied:

- [ ] Test creates valid ForwardRequest struct
- [ ] Test signs ForwardRequest using EIP-712 typed data
- [ ] Test verifies signature using `forwarder.verify(request, signature)`
- [ ] Test with valid signature returns `true`
- [ ] Test with invalid signature returns `false`
- [ ] Test with expired nonce fails verification
- [ ] Test with past deadline fails verification
- [ ] All tests pass successfully

**Test Case**:
```typescript
describe("Meta-Transaction Signature Verification", () => {
  it("Should verify valid signature", async () => {
    const request = {
      from: user.address,
      to: sampleToken.address,
      value: 0,
      gas: 100000,
      nonce: 0,
      deadline: Math.floor(Date.now() / 1000) + 300,
      data: sampleToken.interface.encodeFunctionData("transfer", [recipient.address, 100])
    };

    const signature = await user.signTypedData(domain, types, request);
    const isValid = await forwarder.verify(request, signature);
    expect(isValid).to.be.true;
  });

  it("Should reject invalid signature", async () => {
    const request = { /* ... */ };
    const signature = "0x" + "00".repeat(65); // Invalid signature
    const isValid = await forwarder.verify(request, signature);
    expect(isValid).to.be.false;
  });
});
```

**Verification Method**:
```bash
pnpm run test
# Check test output for "Meta-Transaction Signature Verification" suite
```

---

### AC-8: ERC2771Context Integration Tests

**Given** SampleToken is deployed with ERC2771Forwarder address
**When** meta-transaction is executed through Forwarder
**Then** the following conditions must be satisfied:

- [ ] Test executes meta-transaction via `forwarder.execute(request, signature)`
- [ ] SampleToken's `_msgSender()` returns original user address (not relayer address)
- [ ] Token transfer is executed on behalf of original user
- [ ] Event emission shows original user as sender
- [ ] Direct transaction (non-meta) still works correctly
- [ ] `_msgSender()` returns `msg.sender` for direct transactions
- [ ] All tests pass successfully

**Test Case**:
```typescript
describe("ERC2771Context Integration", () => {
  it("Should extract original sender from meta-transaction", async () => {
    const request = {
      from: user.address,
      to: sampleToken.address,
      value: 0,
      gas: 100000,
      nonce: await forwarder.nonces(user.address),
      deadline: Math.floor(Date.now() / 1000) + 300,
      data: sampleToken.interface.encodeFunctionData("transfer", [recipient.address, 100])
    };

    const signature = await user.signTypedData(domain, types, request);

    // Execute through relayer
    await forwarder.connect(relayer).execute(request, signature);

    // Verify transfer occurred from original user, not relayer
    expect(await sampleToken.balanceOf(user.address)).to.equal(900);
    expect(await sampleToken.balanceOf(recipient.address)).to.equal(100);
  });

  it("Should work with direct transactions (non-meta)", async () => {
    await sampleToken.connect(user).transfer(recipient.address, 50);
    expect(await sampleToken.balanceOf(user.address)).to.equal(950);
  });
});
```

**Verification Method**:
```bash
pnpm run test
# Check test output for "ERC2771Context Integration" suite
```

---

### AC-9: Test Coverage Requirements (TRUST 5 Framework)

**Given** all contracts and tests are implemented
**When** test coverage report is generated
**Then** the following conditions must be satisfied:

- [ ] Overall test coverage >= 85%
- [ ] SampleToken coverage >= 85%
- [ ] SampleNFT coverage >= 85% (if implemented)
- [ ] All critical functions have unit tests
- [ ] All edge cases are covered (invalid signatures, expired deadlines, nonce replay)
- [ ] Coverage report is generated at `coverage/index.html`

**Verification Method**:
```bash
pnpm run test:coverage
# Check coverage report
open coverage/index.html
```

**Expected Output**:
```
--------------------------------|----------|----------|----------|----------|----------------|
File                            |  % Stmts | % Branch |  % Funcs |  % Lines |Uncovered Lines |
--------------------------------|----------|----------|----------|----------|----------------|
 contracts/samples/             |      100 |      100 |      100 |      100 |                |
  SampleToken.sol               |      100 |      100 |      100 |      100 |                |
  SampleNFT.sol                 |      100 |      100 |      100 |      100 |                |
--------------------------------|----------|----------|----------|----------|----------------|
All files                       |    92.5  |    90.0  |    95.0  |    93.0  |                |
--------------------------------|----------|----------|----------|----------|----------------|
```

---

### AC-10: Contract Verification on Polygon Amoy

**Given** contracts are deployed to Polygon Amoy Testnet
**When** verification process completes
**Then** the following conditions must be satisfied:

- [ ] ERC2771Forwarder is verified on PolygonScan
- [ ] SampleToken is verified on PolygonScan
- [ ] SampleNFT is verified on PolygonScan (if deployed)
- [ ] Constructor arguments are correctly matched
- [ ] Verified contract source code is readable on PolygonScan
- [ ] Contract ABI is available on PolygonScan

**Verification Method**:
1. Deploy to Polygon Amoy: `pnpm run deploy:amoy`
2. Check PolygonScan: `https://amoy.polygonscan.com/address/{contractAddress}`
3. Verify "Contract" tab shows verified checkmark ✓

**Expected Result**:
- PolygonScan shows "Contract Source Code Verified (Exact Match)"
- Source code is readable and matches local implementation
- Constructor arguments are decoded correctly

---

## Non-Functional Acceptance Criteria

### AC-11: Compilation Performance

**Given** all contracts are implemented
**When** compilation is executed
**Then** the following conditions must be satisfied:

- [ ] Compilation completes in < 10 seconds (cold start)
- [ ] Compilation completes in < 5 seconds (cached)
- [ ] No compilation warnings or errors
- [ ] TypeChain types are generated successfully

**Verification Method**:
```bash
time pnpm run clean && pnpm run compile
```

**Expected Output**:
```
Compiled 5 Solidity files successfully (evm target: paris).

real    0m8.234s
user    0m6.123s
sys     0m1.234s
```

---

### AC-12: Test Execution Performance

**Given** all tests are implemented
**When** test suite is executed
**Then** the following conditions must be satisfied:

- [ ] All tests complete in < 30 seconds
- [ ] No test timeouts or failures
- [ ] Test output is clear and descriptive

**Verification Method**:
```bash
time pnpm run test
```

**Expected Output**:
```
  ERC2771Forwarder Deployment
    ✓ Should deploy successfully (245ms)
    ✓ Should return correct forwarder name (123ms)

  Meta-Transaction Signature Verification
    ✓ Should verify valid signature (456ms)
    ✓ Should reject invalid signature (234ms)
    ✓ Should reject expired nonce (321ms)

  ERC2771Context Integration
    ✓ Should extract original sender from meta-transaction (567ms)
    ✓ Should work with direct transactions (123ms)

  7 passing (2.1s)

real    0m2.345s
```

---

### AC-13: Deployment Reliability

**Given** deployment scripts are implemented
**When** deployment is executed multiple times
**Then** the following conditions must be satisfied:

- [ ] Deployment succeeds >= 99% of the time on stable networks
- [ ] Deployment failures provide clear error messages
- [ ] Retry logic handles transient network issues
- [ ] Gas estimation is accurate (actual gas used within 10% of estimate)

**Verification Method**:
```bash
# Deploy 10 times to localhost
for i in {1..10}; do
  pnpm run deploy:local
done
```

**Expected Result**: 10 successful deployments with consistent gas usage.

---

### AC-14: Documentation Quality

**Given** implementation is complete
**When** README.md is reviewed
**Then** the following conditions must be satisfied:

- [ ] README.md includes installation instructions
- [ ] README.md includes environment setup guide (.env configuration)
- [ ] README.md includes compilation instructions
- [ ] README.md includes deployment instructions (localhost and Polygon Amoy)
- [ ] README.md includes testing instructions
- [ ] README.md includes contract verification instructions
- [ ] Code examples are copy-paste ready
- [ ] All links are valid and accessible

**Verification Method**: Manual review of README.md

---

## Security Acceptance Criteria

### AC-15: Private Key Security

**Given** deployment scripts require private keys
**When** codebase is reviewed
**Then** the following conditions must be satisfied:

- [ ] No hardcoded private keys in any file
- [ ] `.env` file is included in `.gitignore`
- [ ] `.env.example` contains placeholder values only
- [ ] Scripts fail gracefully with clear error message if private key is missing
- [ ] Private keys are loaded from environment variables only

**Verification Method**:
```bash
grep -r "0x[a-fA-F0-9]{64}" --exclude-dir=node_modules --exclude-dir=.git .
# Should return no matches
```

---

### AC-16: Contract Security Best Practices

**Given** contracts are implemented
**When** security review is performed
**Then** the following conditions must be satisfied:

- [ ] All contracts use OpenZeppelin v5.3.0 (audited library)
- [ ] No custom cryptography implementations
- [ ] No integer overflow/underflow vulnerabilities (Solidity 0.8.27 built-in checks)
- [ ] ERC2771Context overrides follow OpenZeppelin patterns
- [ ] Sample contracts are clearly marked as "for demonstration purposes only"

**Verification Method**: Manual code review and static analysis

---

## Integration Acceptance Criteria

### AC-17: API Gateway Integration Readiness

**Given** contracts are deployed
**When** deployment artifacts are reviewed
**Then** the following conditions must be satisfied:

- [ ] Deployment JSON format matches API Gateway requirements
- [ ] Contract addresses are valid Ethereum addresses (0x + 40 hex characters)
- [ ] TypeChain types are available for API Gateway import
- [ ] Deployment artifacts include all required metadata
- [ ] Artifacts are machine-readable (valid JSON)

**Verification Method**:
```bash
# Validate JSON format
cat deployments/localhost/forwarder.json | jq .
cat deployments/amoy/sample-token.json | jq .
```

---

### AC-18: SPEC-INFRA-001 Integration

**Given** SPEC-INFRA-001 (Docker Compose infrastructure) is completed
**When** contracts are deployed to Hardhat Node container
**Then** the following conditions must be satisfied:

- [ ] Hardhat Node container is accessible at localhost:8545
- [ ] Deployment to Hardhat Node succeeds
- [ ] Contracts are accessible from Docker network
- [ ] API Gateway container can interact with deployed contracts

**Verification Method**:
```bash
# Start Docker infrastructure
docker-compose up hardhat-node

# Deploy contracts
pnpm run deploy:local

# Verify accessibility
curl -X POST http://localhost:8545 -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

---

### AC-19: Sample Token Deployment Network Restriction

**Priority**: High
**Category**: Deployment

**Given** the deployment script `deploy-samples.ts` is executed
**When** the target network is Polygon Amoy (chainId: 80002)
**Then** the script shall:

- [ ] Skip SampleToken deployment
- [ ] Skip SampleNFT deployment
- [ ] Log warning message: "Sample contracts only deploy to localhost"
- [ ] Exit with success code (0)

**Verification Method**:
```bash
# Test on Polygon Amoy
pnpm hardhat run scripts/deploy-samples.ts --network amoy

# Expected output:
# ⚠️  Skipping sample contract deployment on amoy
# Sample contracts (SampleToken, SampleNFT) are only deployed to localhost for testing purposes.
```

**Given** the deployment script `deploy-samples.ts` is executed
**When** the target network is localhost (chainId: 31337)
**Then** the script shall:

- [ ] Deploy SampleToken with forwarder address
- [ ] Deploy SampleNFT with forwarder address (if optional enabled)
- [ ] Save deployment artifacts to `deployments/localhost/`
- [ ] Log deployment success messages

**Verification Method**:
```bash
# Test on localhost
pnpm hardhat run scripts/deploy-samples.ts --network localhost

# Expected files:
# deployments/localhost/sample-token.json
# deployments/localhost/sample-nft.json (if optional)
```

---

## Definition of Done

All acceptance criteria (AC-1 through AC-19) must be satisfied before marking SPEC-CONTRACTS-001 as "completed". The following checklist summarizes completion requirements:

### Implementation Checklist

- [ ] **AC-1**: Hardhat project setup complete
- [ ] **AC-2**: SampleToken contract implemented and tested
- [ ] **AC-3**: SampleNFT contract implemented and tested (Optional)
- [ ] **AC-4**: ERC2771Forwarder deployment script working
- [ ] **AC-5**: Sample contracts deployment script working
- [ ] **AC-6**: Deployment artifact management implemented
- [ ] **AC-7**: Meta-transaction signature verification tests passing
- [ ] **AC-8**: ERC2771Context integration tests passing
- [ ] **AC-9**: Test coverage >= 85% achieved
- [ ] **AC-10**: Contracts verified on Polygon Amoy
- [ ] **AC-19**: Sample token network restriction validated

### Performance Checklist

- [ ] **AC-11**: Compilation completes in < 10 seconds
- [ ] **AC-12**: Tests complete in < 30 seconds
- [ ] **AC-13**: Deployment reliability >= 99%
- [ ] **AC-14**: README.md documentation complete

### Security Checklist

- [ ] **AC-15**: No hardcoded private keys
- [ ] **AC-16**: Security best practices followed

### Integration Checklist

- [ ] **AC-17**: API Gateway integration ready
- [ ] **AC-18**: SPEC-INFRA-001 integration verified

---

## Version Information

- **Acceptance Criteria Version**: 1.1.0
- **Created**: 2025-12-18
- **Last Updated**: 2025-12-18
- **Status**: Pending

---

## Change History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0.0 | 2025-12-18 | Initial acceptance criteria (18 criteria, Given/When/Then format) | manager-spec |
| 1.1.0 | 2025-12-18 | Add AC-19: Sample token network restriction (localhost only deployment) | manager-spec |
