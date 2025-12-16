# Docker Setup Guide

**Version**: 1.0.0
**Last Updated**: 2025-12-16
**Status**: Phase 1 Complete

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Execution](#execution)
5. [Port Reference](#port-reference)
6. [Troubleshooting](#troubleshooting)
7. [Development Workflow](#development-workflow)

---

## Prerequisites

### System Requirements

- **OS**: macOS, Linux, or Windows (Docker Desktop required)
- **Docker**: 24.0.0 or higher
- **Docker Compose**: 2.20.0 or higher
- **RAM**: Minimum 4GB for local development environment
- **Disk Space**: Minimum 10GB free space

### Installation Steps

#### macOS

```bash
# Install Docker Desktop (includes Docker and Docker Compose)
# Download from: https://www.docker.com/products/docker-desktop

# Verify installation
docker --version
docker compose version

# Recommended: Add to PATH if not automatic
# Usually Docker Desktop handles this automatically
```

#### Linux (Ubuntu/Debian)

```bash
# Update package list
sudo apt update

# Install Docker
sudo apt install docker.io -y

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Add user to docker group (optional but recommended)
sudo usermod -aG docker $USER
newgrp docker

# Verify installation
docker --version
docker compose version
```

#### Windows

```bash
# Download Docker Desktop from: https://www.docker.com/products/docker-desktop
# Run installer and follow instructions

# Verify in PowerShell
docker --version
docker compose version
```

---

## Installation

### Step 1: Clone or Navigate to Project

```bash
# Clone the repository
git clone https://github.com/mufin/msq-relayer-service.git
cd msq-relayer-service

# Or navigate to existing repository
cd /path/to/msq-relayer-service
```

### Step 2: Verify Docker Directory Structure

```bash
# Check required files exist
ls -la docker/

# Expected structure:
# docker/
# ├── Dockerfile.packages
# ├── docker-compose.yaml
# ├── docker-compose-amoy.yaml
# ├── config/
# │   └── oz-relayer/
# │       ├── relayer-1.json
# │       ├── relayer-2.json
# │       └── relayer-3.json
# ├── keys-example/
# │   ├── relayer-1/keystore.json
# │   ├── relayer-2/keystore.json
# │   └── relayer-3/keystore.json
# └── keys/
```

### Step 3: Create Keys Directory (if not exists)

```bash
# For local development, copy sample keys
mkdir -p docker/keys
cp -r docker/keys-example/* docker/keys/

# Verify
ls -la docker/keys/
# Should show: relayer-1, relayer-2, relayer-3 directories
```

### Step 4: Build Docker Images

```bash
# Build images (first time only or after code changes)
docker compose -f docker/docker-compose.yaml build

# View built images
docker images | grep msq
```

---

## Configuration

### Environment Variables

Environment variables are specified directly in `docker/docker-compose.yaml`. No `.env` file is used.

**Key Environment Variables**:

| Variable | Value | Service | Purpose |
|----------|-------|---------|---------|
| `RUST_LOG` | `info` | OZ Relayer | Log level |
| `KEYSTORE_PASSPHRASE` | `hardhat-test-passphrase` | OZ Relayer | Keystore password |
| `RPC_URL` | `http://hardhat-node:8545` | OZ Relayer | Blockchain RPC endpoint |
| `REDIS_HOST` | `redis` | OZ Relayer | Redis host |
| `REDIS_PORT` | `6379` | OZ Relayer | Redis port |
| `API_GATEWAY_API_KEY` | `local-dev-api-key` | API Gateway | API authentication key |
| `NODE_ENV` | `development` | API Gateway | Environment mode |

### Customizing Environment Variables

To change environment variables, edit `docker/docker-compose.yaml`:

```yaml
services:
  oz-relayer-1:
    environment:
      RUST_LOG: debug  # Change to debug for verbose logs
      KEYSTORE_PASSPHRASE: your-custom-passphrase
```

Then restart services:

```bash
docker compose -f docker/docker-compose.yaml down
docker compose -f docker/docker-compose.yaml up -d
```

### Network Configuration

Services communicate via Docker internal network `msq-relayer-network`:

```yaml
networks:
  msq-relayer-network:
    driver: bridge
```

**Internal DNS Resolution**:
- `hardhat-node:8545` - Hardhat blockchain RPC
- `redis:6379` - Redis cache
- `api-gateway:3000` - API Gateway
- `oz-relayer-1:8080` - Relayer 1
- `oz-relayer-2:8080` - Relayer 2
- `oz-relayer-3:8080` - Relayer 3

### Volume Configuration

#### Named Volumes

```yaml
volumes:
  msq-relayer-redis-data:
    driver: local
```

**Purpose**: Persistent Redis data storage (AOF - Append-Only File)

**Location**: Docker-managed storage (varies by OS)

#### Source Code Mounts

```yaml
volumes:
  - ../packages/api-gateway/config:/app/config  # Config files
  - ./config/oz-relayer/relayer-1.json:/app/config/config.json:ro  # Read-only relayer config
  - ./keys/relayer-1:/app/config/keys:ro  # Read-only keystores
```

---

## Execution

### Local Development (Hardhat Node)

```bash
# Start all services in background
docker compose -f docker/docker-compose.yaml up -d

# View startup logs
docker compose -f docker/docker-compose.yaml logs

# Follow logs in real-time
docker compose -f docker/docker-compose.yaml logs -f

# View specific service logs
docker compose -f docker/docker-compose.yaml logs api-gateway
docker compose -f docker/docker-compose.yaml logs oz-relayer-1
docker compose -f docker/docker-compose.yaml logs redis
docker compose -f docker/docker-compose.yaml logs hardhat-node
```

### Polygon Amoy Testnet

```bash
# Start services connected to Polygon Amoy
docker compose -f docker/docker-compose-amoy.yaml up -d

# View logs
docker compose -f docker/docker-compose-amoy.yaml logs -f

# Stop services
docker compose -f docker/docker-compose-amoy.yaml down
```

### Service Management

```bash
# Check running services
docker compose -f docker/docker-compose.yaml ps

# Check service health status
docker compose -f docker/docker-compose.yaml ps --format "table {{.Service}}\t{{.Status}}"

# Restart specific service
docker compose -f docker/docker-compose.yaml restart oz-relayer-1

# Stop all services
docker compose -f docker/docker-compose.yaml down

# Stop and remove volumes
docker compose -f docker/docker-compose.yaml down -v

# Rebuild images and start
docker compose -f docker/docker-compose.yaml down
docker compose -f docker/docker-compose.yaml build
docker compose -f docker/docker-compose.yaml up -d
```

### Health Checks

```bash
# Check API Gateway health
curl http://localhost:3000/api/v1/health

# Expected response:
# {
#   "status": "healthy",
#   "timestamp": "2025-12-16T00:00:00.000Z",
#   "services": {
#     "api-gateway": "healthy",
#     "oz-relayer-pool": "healthy",
#     "redis": "healthy"
#   }
# }

# Check individual Relayer health
curl http://localhost:8081/api/v1/health  # Relayer-1
curl http://localhost:8082/api/v1/health  # Relayer-2
curl http://localhost:8083/api/v1/health  # Relayer-3

# Check Redis
docker compose -f docker/docker-compose.yaml exec redis redis-cli ping
# Expected: PONG

# Check Hardhat Node
curl http://localhost:8545 -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
# Expected: {"jsonrpc":"2.0","result":"0x7a69","id":1}
```

---

## Port Reference

### Development Environment (docker-compose.yaml)

| Service | Internal Port | External Port | Protocol | Purpose |
|---------|---------------|---------------|----------|---------|
| Hardhat Node | 8545 | 8545 | HTTP | JSON-RPC blockchain |
| API Gateway | 3000 | 3000 | HTTP | REST API, Swagger UI |
| Relayer-1 | 8080 | 8081 | HTTP | Health check, metrics |
| Relayer-2 | 8080 | 8082 | HTTP | Health check, metrics |
| Relayer-3 | 8080 | 8083 | HTTP | Health check, metrics |
| Redis | 6379 | 6379 | TCP | Cache/Queue |

### Access URLs

```
API Gateway:         http://localhost:3000
Swagger Docs:        http://localhost:3000/api/docs
Hardhat Node RPC:    http://localhost:8545
Relayer-1 Health:    http://localhost:8081/api/v1/health
Relayer-2 Health:    http://localhost:8082/api/v1/health
Relayer-3 Health:    http://localhost:8083/api/v1/health
Redis CLI:           redis-cli -h localhost -p 6379
```

---

## Troubleshooting

### Port Already in Use

**Error**: `bind: address already in use`

**Solution**:

```bash
# Find process using port
lsof -i :3000
lsof -i :8545
lsof -i :6379

# Kill process (if needed)
kill -9 <PID>

# Or use different port by modifying docker-compose.yaml
# Change "3000:3000" to "3001:3000" (external:internal)
```

### Docker Permission Denied

**Error**: `permission denied while trying to connect to Docker daemon`

**Solution**:

```bash
# Linux: Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker ps

# If still failing, restart docker daemon
sudo systemctl restart docker
```

### Services Not Starting

**Error**: Container exits immediately or health checks fail

**Solution**:

```bash
# Check logs
docker compose -f docker/docker-compose.yaml logs

# Check specific service
docker compose -f docker/docker-compose.yaml logs api-gateway

# Rebuild images
docker compose -f docker/docker-compose.yaml down -v
docker compose -f docker/docker-compose.yaml build --no-cache
docker compose -f docker/docker-compose.yaml up -d

# Check service health
docker compose -f docker/docker-compose.yaml ps
```

### Health Check Failures

**Error**: Health checks fail (unhealthy status)

**Solution**:

```bash
# Check API Gateway health
curl http://localhost:3000/api/v1/health

# Check Redis connectivity
docker compose -f docker/docker-compose.yaml exec redis redis-cli ping

# Check Hardhat Node
curl http://localhost:8545 -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'

# If Hardhat Node fails, rebuild
docker compose -f docker/docker-compose.yaml down
docker compose -f docker/docker-compose.yaml build --no-cache hardhat-node
docker compose -f docker/docker-compose.yaml up -d hardhat-node
```

### Redis Data Persistence Issues

**Problem**: Redis data lost after restart

**Solution**:

```bash
# Check volume exists
docker volume ls | grep msq-relayer-redis-data

# Check volume data
docker volume inspect msq-relayer-redis-data

# Ensure AOF enabled in docker-compose.yaml
# command: redis-server --appendonly yes

# If needed, backup data before restart
docker run --rm -v msq-relayer-redis-data:/data \
  -v $(pwd):/backup redis:8.0-alpine \
  cp /data/appendonly.aof /backup/redis-backup.aof
```

### Image Build Failures

**Error**: `docker build` fails with missing packages

**Solution**:

```bash
# Clear Docker cache
docker system prune -a

# Rebuild with no cache
docker compose -f docker/docker-compose.yaml build --no-cache

# Check Dockerfile syntax
docker run --rm -i hadolint/hadolint < docker/Dockerfile.packages

# Update base image
# Edit docker/Dockerfile.packages, update FROM image version
```

### Logs Not Showing

**Problem**: `docker logs` command not working or truncated

**Solution**:

```bash
# View full logs
docker compose -f docker/docker-compose.yaml logs --no-log-prefix

# View specific number of lines
docker compose -f docker/docker-compose.yaml logs --tail=50

# Follow logs continuously
docker compose -f docker/docker-compose.yaml logs -f --tail=20

# Redirect to file
docker compose -f docker/docker-compose.yaml logs > debug.log 2>&1
```

---

## Development Workflow

### Local Development Setup

```bash
# 1. Start all services
docker compose -f docker/docker-compose.yaml up -d

# 2. Verify health
curl http://localhost:3000/api/v1/health

# 3. View logs
docker compose -f docker/docker-compose.yaml logs -f

# 4. Test API (in another terminal)
curl -X POST http://localhost:3000/api/v1/relay/direct \
  -H "Content-Type: application/json" \
  -H "X-API-Key: local-dev-api-key" \
  -d '{"to":"0x0000000000000000000000000000000000000000","data":"0x","value":"0"}'
```

### Code Changes Workflow

```bash
# 1. Make code changes
# 2. Rebuild affected services
docker compose -f docker/docker-compose.yaml build api-gateway

# 3. Restart services
docker compose -f docker/docker-compose.yaml up -d api-gateway

# 4. Check logs
docker compose -f docker/docker-compose.yaml logs -f api-gateway
```

### Testing with Different Networks

```bash
# Local development (Hardhat Node)
docker compose -f docker/docker-compose.yaml up -d

# Polygon Amoy Testnet
docker compose -f docker/docker-compose-amoy.yaml up -d

# Switch between environments by stopping one and starting another
docker compose -f docker/docker-compose.yaml down
docker compose -f docker/docker-compose-amoy.yaml up -d
```

### Debugging Strategies

```bash
# Access container shell
docker compose -f docker/docker-compose.yaml exec api-gateway /bin/sh
docker compose -f docker/docker-compose.yaml exec redis redis-cli

# Check container IP and DNS
docker compose -f docker/docker-compose.yaml exec api-gateway nslookup hardhat-node

# Monitor resource usage
docker stats

# Inspect service configuration
docker compose -f docker/docker-compose.yaml config
```

### Cleaning Up

```bash
# Stop services but keep volumes
docker compose -f docker/docker-compose.yaml down

# Remove everything (including volumes)
docker compose -f docker/docker-compose.yaml down -v

# Clean up unused images
docker image prune

# Clean up unused volumes
docker volume prune

# Full cleanup (be careful!)
docker system prune -a --volumes
```

---

## Related Documents

- [README.md](../README.md) - Project overview and quick start
- [docs/tech.md](./tech.md) - Technical specifications
- [docs/product.md](./product.md) - Product requirements
- [docs/structure.md](./structure.md) - System architecture
- [.moai/specs/SPEC-INFRA-001/spec.md](../.moai/specs/SPEC-INFRA-001/spec.md) - Infrastructure SPEC

---

**Last Updated**: 2025-12-16
**Maintained by**: manager-docs
**Status**: Phase 1 Complete
