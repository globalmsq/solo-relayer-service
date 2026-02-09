# Smart Contracts - Solo Relayer Service

This package contains the smart contracts for the Solo Relayer Service, including ERC20 token (SampleToken) and ERC721 NFT (SampleNFT) with ERC2771 meta-transaction support.

## Quick Start

### Installation

```bash
# Install dependencies
pnpm install

# Compile contracts
pnpm compile

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage
```

### Local Development

```bash
# Start local Hardhat node
pnpm node

# In another terminal, deploy to localhost (all contracts)
pnpm deploy:local
```

### Unified Deployment (SPEC-CONTRACTS-002)

The `pnpm deploy` command supports selective contract deployment via environment variables:

```bash
# Deploy only ERC2771Forwarder (default for production)
DEPLOY_FORWARDER=true \
DEPLOY_SAMPLE_TOKEN=false \
DEPLOY_SAMPLE_NFT=false \
pnpm deploy

# Deploy all contracts (local development)
DEPLOY_FORWARDER=true \
DEPLOY_SAMPLE_TOKEN=true \
DEPLOY_SAMPLE_NFT=true \
pnpm deploy

# Deploy Forwarder + SampleToken only
DEPLOY_FORWARDER=true \
DEPLOY_SAMPLE_TOKEN=true \
pnpm deploy
```

**Environment Variable Defaults:**
| Variable | Default | Description |
|----------|---------|-------------|
| `DEPLOY_FORWARDER` | `true` | Deploy ERC2771Forwarder (required for meta-transactions) |
| `DEPLOY_SAMPLE_TOKEN` | `false` | Deploy SampleToken (development/testing only) |
| `DEPLOY_SAMPLE_NFT` | `false` | Deploy SampleNFT (development/testing only) |

**Note:** SampleToken and SampleNFT require Forwarder. Attempting to deploy them without Forwarder will result in an error.

### Deployment to Testnet (Polygon Amoy)

**Step 1: Configure `.env`**

```bash
# Network configuration
RPC_URL=https://rpc-amoy.polygon.technology
CHAIN_ID=80002
PRIVATE_KEY=your_private_key_here

# For contract verification (get from https://etherscan.io/myapikey)
ETHERSCAN_API_KEY=your_etherscan_api_key
```

**Step 2: Deploy ERC2771Forwarder**

```bash
pnpm deploy:forwarder
```

Output:
```
Deploying ERC2771Forwarder...
ERC2771Forwarder deployed to: 0x...
```

**Step 3: Verify Contract**

```bash
pnpm verify --contract contracts/ERC2771Forwarder.sol:ERC2771Forwarder <FORWARDER_ADDRESS> "SoloForwarder"
```

Example:
```bash
pnpm verify --contract contracts/ERC2771Forwarder.sol:ERC2771Forwarder 0xE8a3C8e530dddd14e02DA1C81Df6a15f41ad78DE "SoloForwarder"
```

**Deployed Contracts (Polygon Amoy)**

| Contract | Address |
|----------|---------|
| ERC2771Forwarder | `0xE8a3C8e530dddd14e02DA1C81Df6a15f41ad78DE` |
| SampleToken | `0x2D5DF49783c4F192B08f478C5CdDFBbbe2aD50fd` |
| SampleNFT | `0x6517f1CB9852c1a38Bad42935673B79cD7c37129` |

## Contract Architecture

### SampleToken (ERC20 + ERC2771Context)

An ERC20 token with meta-transaction support, pausable functionality, and owner-based access control.

**Features:**
- ERC20 standard token (SMPL)
- Initial supply: 1,000,000 tokens
- Pausable: Owner can pause/unpause all transfers
- Burnable: Token holders can burn their tokens
- Mintable: Owner can mint additional tokens
- ERC2771Context: Support for gasless transactions through meta-transaction forwarder

**Key Functions:**
- `transfer(to, amount)` - Transfer tokens
- `approve(spender, amount)` - Approve spending
- `transferFrom(from, to, amount)` - Transfer on behalf
- `mint(to, amount)` - Mint tokens (owner only)
- `burn(amount)` - Burn tokens
- `pause()` / `unpause()` - Control transfers (owner only)

### SampleNFT (ERC721 + ERC2771Context)

An ERC721 NFT contract with enumeration and meta-transaction support.

**Features:**
- ERC721 standard NFT (SNFT)
- ERC721Enumerable: Support for enumerating all tokens
- Burnable: NFT owners can burn their NFTs
- ERC2771Context: Support for gasless transactions through meta-transaction forwarder
- Auto-incrementing token IDs starting from 1

**Key Functions:**
- `mint(to)` - Mint NFT (owner only)
- `transferFrom(from, to, tokenId)` - Transfer NFT
- `approve(to, tokenId)` - Approve NFT transfer
- `setApprovalForAll(operator, approved)` - Approve all NFTs
- `burn(tokenId)` - Burn NFT

### IERC2771Forwarder

Interface for ERC2771 meta-transaction forwarder. Defines the contract that relays transactions on behalf of users.

## Testing

The package includes comprehensive test coverage across multiple test files:

### Test Files

- **Contracts.test.ts** - Comprehensive unified tests (27 passing tests)
  - ERC20 functionality (transfers, approvals, minting, burning)
  - ERC721 functionality (minting, transfers, approvals)
  - ERC2771 meta-transaction support
  - Ownership and access control
  - Error handling and event emission

### Running Tests

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test test/Contracts.test.ts

# Run with coverage report
pnpm test:coverage
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm compile` | Compile contracts |
| `pnpm test` | Run tests (27 passing tests covering all functionality) |
| `pnpm test:coverage` | Run tests with coverage report |
| `pnpm node` | Start local Hardhat node |
| `pnpm deploy` | Unified deployment (selective via `DEPLOY_*` env vars) |
| `pnpm deploy:local` | Deploy all sample contracts (SampleToken + SampleNFT) |
| `pnpm deploy:forwarder` | Deploy ERC2771Forwarder only |
| `pnpm verify` | Verify contract on block explorer |
| `pnpm clean` | Clean artifacts |
| `pnpm typechain` | Generate TypeChain types |

## Networks

Network configuration is now **network agnostic**. Set `RPC_URL` and `CHAIN_ID` for any network:

| Network | CHAIN_ID | RPC_URL |
|---------|----------|---------|
| Hardhat (in-memory) | 31337 | N/A (default test network) |
| Hardhat node (local) | 31337 | http://localhost:8545 |
| Hardhat node (Docker) | 31337 | http://hardhat-node:8545 |
| Polygon Amoy | 80002 | https://rpc-amoy.polygon.technology |
| Polygon Mainnet | 137 | https://polygon-rpc.com |

## Project Structure

```
contracts/              # Solidity source files
├── interfaces/         # Interface definitions
│   └── IERC2771Forwarder.sol
├── samples/            # Sample contracts
│   ├── SampleToken.sol
│   └── SampleNFT.sol
scripts/                # Deployment scripts
├── deploy.ts           # Unified entry point (SPEC-CONTRACTS-002)
├── deploy-forwarder.ts # Legacy: Forwarder-only deployment
├── deploy-samples.ts   # Legacy: Sample contracts deployment
├── deployers/          # Modular deployer functions
│   ├── index.ts        # Re-exports all deployers
│   ├── forwarder.ts    # ERC2771Forwarder deployer
│   ├── sample-token.ts # SampleToken deployer
│   └── sample-nft.ts   # SampleNFT deployer
└── utils/
test/                   # Test files
artifacts/              # Compiled contracts (generated)
typechain-types/        # TypeScript types (generated)
```

## Development Workflow

1. Write contracts in `contracts/`
2. Write tests in `test/`
3. Run tests: `pnpm test`
4. Deploy locally: `pnpm node` + `pnpm deploy:local`
5. Deploy to testnet: Configure `.env` with RPC_URL/CHAIN_ID, then `pnpm deploy:forwarder`
6. Verify: `pnpm verify --contract <path:Contract> <address> "<args>"`

## Configuration

### Hardhat Config

Networks configured in `hardhat.config.ts`:

- **hardhat**: In-memory test network (ChainID: 31337)
- **external**: Network agnostic external connection (uses RPC_URL + CHAIN_ID)

### Environment Variables

Create `.env` file with (network agnostic configuration):

```bash
# Private key for deployments
PRIVATE_KEY=<your_private_key>

# Network Agnostic RPC Configuration
# Set these for any network:
# - Hardhat node: RPC_URL=http://localhost:8545 CHAIN_ID=31337
# - Amoy testnet: RPC_URL=https://rpc-amoy.polygon.technology CHAIN_ID=80002
RPC_URL=http://localhost:8545
CHAIN_ID=31337

# Contract verification (Etherscan V2 API - works for all networks)
# Get your API key from: https://etherscan.io/myapikey
ETHERSCAN_API_KEY=<your_api_key>
```

## Key Safety Considerations

### Ownership Model

Both contracts use OpenZeppelin's Ownable pattern:
- Owner controls minting, pausing, and administrative functions
- Owner is set to the deployer at deployment time
- Consider using multi-sig wallet for production

### ERC2771 Forwarder

Contracts initialize with a trusted forwarder address:
- Only set a verified forwarder implementation
- Ensure the forwarder is properly audited

### Pausable Tokens

The pause mechanism allows the owner to freeze all transfers:
- Useful for emergency situations
- Use with caution as it impacts users

## OpenZeppelin Version

- **@openzeppelin/contracts**: 5.4.0
- Uses latest V5 patterns with Solidity 0.8.27

## Docker Integration

This package is used by the `hardhat-node` Docker service in `docker/docker-compose.yaml`.

```yaml
hardhat-node:
  build:
    context: ..
    dockerfile: docker/Dockerfile.packages
    target: hardhat-node
```

## License

SPDX-License-Identifier: MIT
