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
[ERROR] Missing required environment variables: RELAY_API_KEY, NODE_ENV
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
docker stats msq-relay-api msq-redis

# Resource limits
docker inspect msq-relay-api | jq '.[0].HostConfig.Memory'
```

---

## 5. New Team Member Onboarding Checklist

- [ ] Read this document
- [ ] Install Docker Desktop
- [ ] Configure `.env` file
- [ ] Start service with `pnpm run start:dev`
- [ ] Access Swagger UI at `http://localhost:3000/api/docs`
- [ ] Extract OpenAPI JSON with curl
- [ ] Understand common troubleshooting scenarios

---

## 6. Additional Resources

- **[README.md](../README.md)** - Project overview
- **[Swagger UI](http://localhost:3000/api/docs)** - API documentation
- **[OpenAPI JSON](http://localhost:3000/api/docs-json)** - OpenAPI 3.0 spec

---

**Last Updated**: 2024-12-25
**Author**: MoAI-ADK
