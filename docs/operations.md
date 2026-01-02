# MSQ Relayer Service - Operations Guide

## Overview

This document describes the operational procedures for MSQ Relayer Service development environment.

**Key Topics**:
- Service start/stop procedures
- API documentation access
- Client SDK generation guide
- Monitoring and troubleshooting

---

## 1. Service Start/Stop Procedures

### Development Environment

**Start the service**:
```bash
# Navigate to relay-api package
cd packages/relay-api

# Start in development mode (with hot reload)
pnpm run start:dev

# Or start in production mode locally
pnpm run start:prod
```

**Environment variables**:
Copy `.env.example` to create your local environment file:
```bash
cp .env.example .env
# Or for specific environments:
# cp .env.example .env.development
```

Then edit the file and set secure values for sensitive variables:
- `RELAY_API_KEY` - Generate a secure random key (never use placeholder values)
- `KEYSTORE_PASSPHRASE` - Use a strong, unique passphrase

### Docker Development Environment

**Start all services**:
```bash
cd docker
docker-compose up -d
```

**Stop all services**:
```bash
cd docker
docker-compose down
```

### Health Check

```bash
# Check service health
curl http://localhost:3000/api/v1/health | jq

# Expected response
{
  "status": "ok",
  "info": {
    "oz-relayer-pool": {
      "status": "healthy",
      "healthyCount": 3,
      "totalCount": 3
    },
    "redis": {
      "status": "healthy"
    }
  }
}
```

---

## 2. API Documentation Access

### Swagger UI

Access API documentation in your browser:

**Development**:
```
http://localhost:3000/api/docs
```

### OpenAPI JSON

Download OpenAPI 3.0 specification:

```bash
curl http://localhost:3000/api/docs-json > openapi.json
```

### API Key Authentication

1. **In Swagger UI**:
   - Click "Authorize" button at top
   - Enter API key in `x-api-key` field
   - Click "Authorize" to enable authentication

2. **With curl**:
   ```bash
   curl -H "x-api-key: your-api-key-here" http://localhost:3000/api/v1/health
   ```

3. **In TypeScript/JavaScript**:
   ```typescript
   const headers = {
     'x-api-key': 'your-api-key-here',
     'Content-Type': 'application/json'
   };

   const response = await fetch('http://localhost:3000/api/v1/health', {
     method: 'GET',
     headers
   });
   ```

---

## 3. Client SDK Generation Guide

### Prerequisites

- OpenAPI Generator CLI
- OpenAPI JSON file (`openapi.json`)

### Step 1: Extract OpenAPI JSON

```bash
curl http://localhost:3000/api/docs-json > openapi.json
```

### Step 2: Generate TypeScript Client SDK

```bash
npx @openapitools/openapi-generator-cli generate \
  -i openapi.json \
  -g typescript-axios \
  -o ./generated/client
```

### Step 3: Use Generated SDK

```typescript
import { DefaultApi } from './generated/client';

// Initialize API client
const api = new DefaultApi({
  basePath: 'http://localhost:3000',
  headers: {
    'x-api-key': 'your-api-key-here'
  }
});

// Call Direct Transaction API
const response = await api.sendDirectTransaction({
  to: '0x1234567890123456789012345678901234567890',
  data: '0xabcdef',
  value: '1000000000000000000'
});

console.log(response.data);
```

---

## 4. Monitoring and Troubleshooting

### Log Monitoring

```bash
# Docker container logs
docker logs msq-relay-api

# Real-time log tracking
docker logs -f msq-relay-api

# OZ Relayer logs
docker logs msq-oz-relayer-1
```

### Container Status

```bash
# Check all container status
docker ps | grep msq-

# Container details
docker inspect msq-relay-api
```

### Common Troubleshooting Scenarios

#### Scenario 1: Health Check Failure

**Symptom**: `/api/v1/health` returns 503 Service Unavailable

**Cause**: Redis or OZ Relayer connection failure

**Resolution**:

1. Check Redis status
   ```bash
   docker logs msq-redis
   docker exec msq-redis redis-cli ping
   ```
   Expected: `PONG`

2. Check OZ Relayer status
   ```bash
   docker logs msq-oz-relayer-1
   ```

3. Restart service
   ```bash
   cd docker && docker-compose restart relay-api
   ```

#### Scenario 2: Missing Environment Variables

**Symptom**: Error message on startup:
```
[ERROR] Missing required environment variables: RELAY_API_KEY
```

**Resolution**:

1. Check environment file
   ```bash
   cat packages/relay-api/.env
   ```

2. Copy `.env.example` and set required values:
   ```bash
   cp .env.example .env
   # Edit .env and set RELAY_API_KEY with a secure value
   ```

3. Restart service

#### Scenario 3: Port Conflict

**Symptom**: Error on startup:
```
Error: bind: address already in use
```

**Resolution**:

1. Find process using port
   ```bash
   # macOS/Linux
   lsof -i :3000

   # Windows
   netstat -ano | findstr :3000
   ```

2. Kill the process
   ```bash
   kill -9 <PID>
   ```

3. Restart service

### Performance Monitoring

```bash
# CPU and memory usage
docker stats msq-relay-api msq-redis msq-mysql

# Resource limits
docker inspect msq-relay-api | jq '.[0].HostConfig.Memory'
```

---

## 5. Database Operations (Phase 2)

### MySQL Management

**Start MySQL service** (with Phase 2 profile):
```bash
docker compose -f docker/docker-compose.yaml --profile phase2 up -d mysql
```

**Connect to MySQL**:
```bash
# Via Docker
docker exec -it msq-mysql mysql -u root -ppass msq_relayer

# Via CLI (requires mysql client)
mysql -h localhost -P 3307 -u root -ppass msq_relayer
```

**Check database status**:
```bash
# Verify connection
docker exec msq-mysql mysql -u root -ppass -e "SELECT 1"

# Check tables
docker exec msq-mysql mysql -u root -ppass msq_relayer -e "SHOW TABLES"

# Check transaction count
docker exec msq-mysql mysql -u root -ppass msq_relayer -e "SELECT COUNT(*) FROM transactions"
```

### Prisma Operations

**Run migrations**:
```bash
cd packages/relay-api

# Apply pending migrations
pnpm prisma migrate deploy

# Create new migration (development only)
pnpm prisma migrate dev --name <migration_name>

# Reset database (WARNING: deletes all data)
pnpm prisma migrate reset
```

**Generate Prisma client**:
```bash
pnpm prisma generate
```

**Open Prisma Studio** (GUI for database):
```bash
pnpm prisma studio
# Opens at http://localhost:5555
```

### Database Troubleshooting

#### Scenario: Migration failed

**Symptom**: `prisma migrate deploy` fails

**Resolution**:
1. Check migration status
   ```bash
   pnpm prisma migrate status
   ```

2. Check database connectivity
   ```bash
   docker exec msq-mysql mysql -u root -ppass -e "SELECT 1"
   ```

3. If schema is out of sync, reset (development only)
   ```bash
   pnpm prisma migrate reset
   ```

#### Scenario: Connection refused

**Symptom**: `Error: Can't connect to MySQL server`

**Resolution**:
1. Verify MySQL is running
   ```bash
   docker ps | grep mysql
   ```

2. Check DATABASE_URL format
   ```
   DATABASE_URL=mysql://root:pass@localhost:3307/msq_relayer
   ```

3. Verify port mapping
   ```bash
   docker port msq-mysql
   ```

---

## 6. Redis Management (Phase 2)

### Redis Operations

**Connect to Redis CLI**:
```bash
docker exec -it msq-redis redis-cli
```

**Check Redis status**:
```bash
# Ping test
docker exec msq-redis redis-cli ping
# Expected: PONG

# Get info
docker exec msq-redis redis-cli info server

# Check memory usage
docker exec msq-redis redis-cli info memory | grep used_memory_human
```

**View cached transactions**:
```bash
# List all transaction keys
docker exec msq-redis redis-cli keys "tx:*"

# Get specific transaction
docker exec msq-redis redis-cli get "tx:<transaction_id>"

# Check TTL
docker exec msq-redis redis-cli ttl "tx:<transaction_id>"
```

**Clear cache** (use with caution):
```bash
# Clear all keys (development only)
docker exec msq-redis redis-cli flushall

# Clear specific pattern
docker exec msq-redis redis-cli --scan --pattern "tx:*" | xargs -L 1 docker exec msq-redis redis-cli del
```

### Cache Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| TTL | 86400s (24h) | Default cache expiration |
| Terminal Status TTL | 86400s | confirmed/mined/failed/cancelled |
| Pending Status TTL | No cache | Always query L3 (OZ Relayer) |

### Redis Troubleshooting

#### Scenario: Cache miss for confirmed transaction

**Symptom**: 3-Tier Lookup always hits L3 for confirmed transactions

**Cause**: Cache not populated or expired

**Resolution**:
1. Check if key exists
   ```bash
   docker exec msq-redis redis-cli exists "tx:<transaction_id>"
   ```

2. Verify write-through is working (check application logs)
   ```bash
   docker logs msq-relay-api | grep "Cache"
   ```

3. Manually verify transaction in MySQL
   ```bash
   docker exec msq-mysql mysql -u root -ppass msq_relayer \
     -e "SELECT * FROM transactions WHERE transaction_id='<id>'"
   ```

---

## 7. Webhook Configuration (Phase 2)

### Webhook Setup

**Required Environment Variables**:
```bash
# OZ Relayer webhook signature verification
WEBHOOK_SIGNING_KEY=your-secret-signing-key

# Client notification endpoint (optional)
CLIENT_WEBHOOK_URL=https://your-service.example.com/webhooks
```

**OZ Relayer Webhook Endpoint**:
```
POST /api/v1/webhooks/oz-relayer
```

### Webhook Testing

**Test webhook with curl**:
```bash
# Generate HMAC-SHA256 signature
PAYLOAD='{"transactionId":"tx_123","status":"confirmed","hash":"0xabc..."}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "your-secret-signing-key" | cut -d' ' -f2)

# Send webhook request
curl -X POST http://localhost:3000/api/v1/webhooks/oz-relayer \
  -H "Content-Type: application/json" \
  -H "X-OZ-Signature: sha256=$SIGNATURE" \
  -d "$PAYLOAD"
```

**Expected Response** (HTTP 200):
```json
{
  "success": true,
  "message": "Webhook processed"
}
```

### Webhook Security

| Header | Required | Description |
|--------|----------|-------------|
| `X-OZ-Signature` | Yes | HMAC-SHA256 signature |
| `Content-Type` | Yes | Must be `application/json` |

**Signature Verification**:
1. Extract signature from `X-OZ-Signature` header (format: `sha256=<hex>`)
2. Compute HMAC-SHA256 of raw request body using `WEBHOOK_SIGNING_KEY`
3. Compare signatures using constant-time comparison
4. Reject if signatures don't match (HTTP 401)

### Webhook Troubleshooting

#### Scenario: Signature verification failed

**Symptom**: HTTP 401 Unauthorized response

**Resolution**:
1. Verify WEBHOOK_SIGNING_KEY matches OZ Relayer configuration
2. Ensure raw body is used for signature (not parsed JSON)
3. Check signature format: `sha256=<hex_signature>`

#### Scenario: Client notification failed

**Symptom**: Webhook processed but client not notified

**Resolution**:
1. Verify CLIENT_WEBHOOK_URL is set correctly
2. Check client endpoint is accessible from relay-api container
3. Review logs for notification errors
   ```bash
   docker logs msq-relay-api | grep "webhook"
   ```

---

## 8. New Team Member Onboarding Checklist

- [ ] Read this document
- [ ] Install Docker Desktop
- [ ] Configure `.env` file (including Phase 2 variables)
- [ ] Start service with `pnpm run start:dev`
- [ ] Access Swagger UI at `http://localhost:3000/api/docs`
- [ ] Extract OpenAPI JSON with curl
- [ ] Understand common troubleshooting scenarios
- [ ] (Phase 2) Verify MySQL and Redis connectivity
- [ ] (Phase 2) Run Prisma migrations

---

## 9. Additional Resources

- **[README.md](../README.md)** - Project overview
- **[Swagger UI](http://localhost:3000/api/docs)** - API documentation
- **[OpenAPI JSON](http://localhost:3000/api/docs-json)** - OpenAPI 3.0 spec

---

**Last Updated**: 2026-01-02
**Version**: 1.1.0
**Author**: MoAI-ADK
