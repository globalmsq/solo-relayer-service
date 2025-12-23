# Smart Contracts Integration Guide

**Version**: 1.0
**Last Updated**: 2025-12-19
**Status**: Phase 1 Complete

---

## Overview

This guide explains how to use MSQ Relayer Service smart contracts for gasless transaction support. It covers ERC2771Forwarder deployment, contract integration patterns, and signature verification.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Contract Architecture](#contract-architecture)
3. [ERC2771Forwarder Deployment](#erc2771forwarder-deployment)
4. [Contract Integration Patterns](#contract-integration-patterns)
5. [EIP-712 Signature Generation](#eip-712-signature-generation)
6. [Testing](#testing)
7. [Production Deployment](#production-deployment)

---

## Quick Start

### 1. Deploy Forwarder to Hardhat (Local Development)

```bash
cd packages/contracts
npx hardhat run scripts/deploy-forwarder.ts --network localhost
```

**Output**:
```json
{
  "address": "0x...",
  "network": "localhost",
  "chainId": 31337,
  "name": "Relayer-Forwarder-localhost"
}
```

### 2. Deploy Sample Contracts (Localhost Only)

```bash
npx hardhat run scripts/deploy-samples.ts --network localhost
```

**Creates**:
- ERC2771Forwarder: `0x...`
- SampleToken: `0x...`
- SampleNFT: `0x...`

### 3. Call Relayer API with Gasless Transaction

```bash
# Generate EIP-712 signature (client-side)
const signature = await signForwardRequest(forwardRequest, userPrivateKey);

# Submit to Relayer API
curl -X POST http://localhost:3000/api/v1/relay/gasless \
  -H "Content-Type: application/json" \
  -H "X-API-Key: local-dev-api-key" \
  -d '{
    "request": {
      "from": "0xUserAddress...",
      "to": "0xTokenAddress...",
      "value": "0",
      "gas": "100000",
      "nonce": "0",
      "deadline": 1702656000,
      "data": "0xa9059cbb..."
    },
    "signature": "0x..."
  }'
```

---

## Contract Architecture

### ERC2771Forwarder

**Purpose**: Meta-transaction forwarder that extracts original user address from signed requests

**Location**: `contracts/ERC2771Forwarder.sol` (wrapper around OpenZeppelin's standard)

**Key Features**:
- EIP-712 signature verification
- Per-user nonce tracking (prevents replay attacks)
- Deadline validation (transaction validity period)
- Batch execution support

**Domain Structure**:
```solidity
Domain {
  name: "Relayer-Forwarder-{network}",  // Set during deployment
  version: "1",
  chainId: {network_chain_id},
  verifyingContract: {forwarder_address}
}
```

### SampleToken.sol (ERC20 + ERC2771Context)

**Demonstrates**: Gasless token transfer pattern

**Key Changes from Standard ERC20**:
```solidity
// Constructor accepts forwarder address
constructor(address forwarder) ERC20("Sample", "SMPL") ERC2771Context(forwarder) {}

// Override _msgSender to support meta-transactions
function _msgSender() internal view override(ERC20, ERC2771Context) returns (address) {
  return ERC2771Context._msgSender();
}

// Override _contextSuffixLength for proper decoding
function _contextSuffixLength() internal view override(ERC20, ERC2771Context) returns (uint256) {
  return ERC2771Context._contextSuffixLength();
}
```

**Usage in Relay**:
- User calls `transfer()` via ERC2771Forwarder
- Forwarder extracts user address from signature
- Token contract receives `_msgSender() = user`, not relayer

### SampleNFT.sol (ERC721 + ERC2771Context)

**Demonstrates**: Gasless NFT minting pattern

**Key Implementation**: Same pattern as SampleToken with ERC721 base class

---

## ERC2771Forwarder Deployment

### Local Deployment (Hardhat)

```bash
npx hardhat run scripts/deploy-forwarder.ts --network localhost
```

**Deployment Process**:
1. Get deployer signer from Hardhat
2. Detect network (Chain ID)
3. Set forwarder name based on network
4. Deploy ERC2771Forwarder contract
5. Save deployment artifact to `deployments/localhost/forwarder.json`

### Polygon Amoy Deployment

```bash
# 1. Set environment variables (Network Agnostic)
export RPC_URL="https://rpc-amoy.polygon.technology"
export CHAIN_ID="80002"
export PRIVATE_KEY="0x..."

# 2. Deploy contract
npx hardhat run scripts/deploy-forwarder.ts --network external

# 3. Verify on block explorer (optional)
npx hardhat verify --network external <CONTRACT_ADDRESS>
```

**Artifact**: `deployments/external/forwarder.json`

### Production Deployment

**Requirements**:
- Private key with sufficient MATIC for gas
- RPC endpoint access
- Deployer address has sufficient funds

**Steps**:
1. Create deployer account with production funds
2. Configure network in `hardhat.config.ts`
3. Deploy: `npx hardhat run scripts/deploy-forwarder.ts --network mainnet`
4. Save deployment artifact in version control
5. Update Relayer configuration with forwarder address

---

## Contract Integration Patterns

### Pattern 1: Basic ERC20 with Meta-Transaction Support

```solidity
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

contract MyToken is ERC20, ERC2771Context {
  // 1. Accept forwarder address in constructor
  constructor(address forwarder)
    ERC20("My Token", "MTK")
    ERC2771Context(forwarder)
  {
    _mint(msg.sender, 1000000 * 10 ** 18);
  }

  // 2. Override _msgSender for meta-transaction support
  function _msgSender()
    internal
    view
    override(ERC20, ERC2771Context)
    returns (address)
  {
    return ERC2771Context._msgSender();
  }

  // 3. Override _contextSuffixLength
  function _contextSuffixLength()
    internal
    view
    override(ERC20, ERC2771Context)
    returns (uint256)
  {
    return ERC2771Context._contextSuffixLength();
  }
}
```

### Pattern 2: Custom Contract with ERC2771Context

```solidity
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

contract CustomContract is ERC2771Context {
  mapping(address => uint256) public balances;

  constructor(address forwarder) ERC2771Context(forwarder) {}

  // Use _msgSender() instead of msg.sender
  function deposit() external payable {
    address user = _msgSender();  // ✅ Works with meta-transactions
    balances[user] += msg.value;
  }

  function withdraw(uint256 amount) external {
    address user = _msgSender();  // ✅ Correctly identifies user
    require(balances[user] >= amount);
    balances[user] -= amount;
    (bool success, ) = payable(user).call{value: amount}("");
    require(success);
  }
}
```

### Pattern 3: Multi-Contract Integration

```solidity
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

// Token 1: Supports meta-transactions
contract PaymentToken is ERC20, ERC2771Context {
  constructor(address forwarder) ERC20("Payment", "PAY") ERC2771Context(forwarder) {}

  function _msgSender() internal view override(ERC20, ERC2771Context) returns (address) {
    return ERC2771Context._msgSender();
  }

  function _contextSuffixLength() internal view override(ERC20, ERC2771Context) returns (uint256) {
    return ERC2771Context._contextSuffixLength();
  }
}

// Token 2: Standard ERC20 (calls PaymentToken)
contract RewardToken is ERC20 {
  PaymentToken public paymentToken;

  constructor(address _paymentToken) ERC20("Reward", "RWD") {
    paymentToken = PaymentToken(_paymentToken);
  }

  // Receive payment via meta-transaction and issue reward
  function claimReward() external {
    // This function is called normally (msg.sender is user)
    // But paymentToken can be called via meta-transaction
    _mint(msg.sender, 100 * 10 ** 18);
  }
}
```

---

## EIP-712 Signature Generation

### JavaScript/TypeScript Example (ethers.js v6)

```typescript
import { ethers } from 'ethers';

// 1. Define EIP-712 Domain
const domain = {
  name: "Relayer-Forwarder-polygon",
  version: "1",
  chainId: 137,
  verifyingContract: "0x..." // Forwarder address
};

// 2. Define ForwardRequest Type
const types = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" }
  ]
};

// 3. Create ForwardRequest object
const forwardRequest = {
  from: userAddress,
  to: tokenAddress,
  value: "0",
  gas: "100000",
  nonce: "0",
  deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour validity
  data: tokenContract.interface.encodeFunctionData("transfer", [recipientAddress, "1000000000000000000"])
};

// 4. Sign using EIP-712
async function signForwardRequest(request, signer) {
  const signature = await signer.signTypedData(domain, types, request);
  return signature;
}

// 5. Submit to Relayer API
async function submitGaslessTransaction(request, signature) {
  const response = await fetch('http://localhost:3000/api/v1/relay/gasless', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'local-dev-api-key'
    },
    body: JSON.stringify({
      request,
      signature
    })
  });
  return response.json();
}
```

### Nonce Management

```typescript
// Get current nonce for user
async function getCurrentNonce(userAddress) {
  const response = await fetch(
    `http://localhost:3000/api/v1/relay/nonce/${userAddress}`
  );
  const data = await response.json();
  return data.data.nonce;
}

// Use nonce in forward request
const nonce = await getCurrentNonce(userAddress);
const forwardRequest = {
  ...forwardRequest,
  nonce // Include user's current nonce
};
```

---

## Testing

### Running Contract Tests

```bash
# Unit tests for all contracts
npx hardhat test

# Run specific test file
npx hardhat test test/forwarder.test.ts

# Run with coverage
npx hardhat coverage
```

### Test Coverage

| Test File | Coverage | Cases |
|-----------|----------|-------|
| `forwarder.test.ts` | ERC2771Forwarder | Signature verification, Nonce management, Deadline validation |
| `sample-token.test.ts` | SampleToken | Gasless transfer, Context integration, _msgSender() verification |
| `sample-nft.test.ts` | SampleNFT | Gasless minting, Context integration, Ownership tracking |

### Manual Testing on Hardhat

```typescript
// Test signature verification
const tx = await forwarder.verify(forwardRequest, signature);
expect(tx).to.be.true;

// Test execution
const result = await forwarder.execute(forwardRequest, signature);
expect(result.status).to.equal(1); // Success

// Verify nonce was incremented
const newNonce = await forwarder.nonces(userAddress);
expect(newNonce).to.equal(1);
```

---

## Production Deployment

### Pre-Production Checklist

- [ ] Contract code audited
- [ ] Forwarder deployed to testnet
- [ ] Sample contracts deployed and tested
- [ ] Relayer API tested with gasless transactions
- [ ] Health check endpoints verified
- [ ] Signature verification working correctly
- [ ] Gas estimation accurate
- [ ] Emergency pause mechanism tested

### Deployment Steps

1. **Deploy Forwarder to Mainnet**
   ```bash
   npx hardhat run scripts/deploy-forwarder.ts --network polygon
   ```

2. **Deploy Target Contracts**
   - Create target contracts with ERC2771Context
   - Deploy to same network
   - Save addresses in secure vault

3. **Update Relayer Configuration**
   ```json
   {
     "forwarder": "0x...",
     "networks": ["polygon"],
     "initialBalance": "10 MATIC"
   }
   ```

4. **Configure API Gateway**
   ```bash
   RELAY_API_KEY=production-key-32ch
   OZ_RELAYER_URL=http://oz-relayer-lb
   ```

5. **Enable Monitoring**
   - Set up balance monitoring (OZ Monitor)
   - Configure alerts for failed transactions
   - Enable webhook logging

### Disaster Recovery

**Forwarder Compromise**:
1. Deploy new ERC2771Forwarder
2. Migrate contracts to new forwarder address
3. Update API configuration
4. Notify all clients of new forwarder address

**Private Key Compromise**:
1. Rotate signer key in AWS KMS
2. Deploy new key in OZ Relayer
3. Monitor all transactions
4. Audit transaction history

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Signature verification fails | Wrong domain | Verify domain matches forwarder's domain hash |
| Nonce mismatch | Stale nonce | Query current nonce via `/api/v1/relay/nonce/{address}` |
| Deadline expired | Transaction too old | Use recent timestamp (within 1 hour) |
| Insufficient gas | Gas limit too low | Increase gas limit in ForwardRequest |
| _msgSender() returns relayer | Context not overridden | Implement both _msgSender() and _contextSuffixLength() |

### Debug Commands

```bash
# Verify forwarder deployment
curl http://localhost:3000/api/v1/relay/pool-status

# Query user nonce
curl http://localhost:3000/api/v1/relay/nonce/0xUserAddress

# Get transaction status
curl http://localhost:3000/api/v1/relay/status/tx_abc123

# View relayer health
curl http://localhost:3000/api/v1/health
```

---

## Related Documentation

- **[tech.md - Section 4: Smart Contracts Technical Stack](./tech.md#4-smart-contracts-technical-stack)** - Detailed technical specifications
- **[SPEC-CONTRACTS-001](../.moai/specs/SPEC-CONTRACTS-001/spec.md)** - Smart Contracts Specification
- **[Hardhat Documentation](https://hardhat.org/)** - Development framework guide
- **[OpenZeppelin ERC2771](https://docs.openzeppelin.com/contracts/5.x/api/metatx)** - Official ERC2771 documentation

---

**Last Updated**: 2025-12-19
**Version**: 1.0
**Author**: MSQ Relayer Team
