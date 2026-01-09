# Deployment Guide

**Document Version**: 1.0.0
**Last Updated**: 2026-01-06
**Status**: Complete
**SPEC**: [SPEC-QUEUE-001](./../.moai/specs/SPEC-QUEUE-001/spec.md)

## Quick Start

### Local Development

```bash
# 1. Start all services
docker compose -f docker/docker-compose.yaml up -d

# 2. Wait for services to be healthy
docker compose ps

# 3. Run database migrations
pnpm --filter @msq-relayer/relay-api run prisma:migrate:dev

# 4. Start services in development
pnpm --filter @msq-relayer/relay-api run start:dev
pnpm --filter @msq-relayer/queue-consumer run start:dev

# 5. Test
curl http://localhost:3000/api/v1/health
```

---

## Environment Variables

### relay-api Configuration

```bash
# Core
PORT=3000
NODE_ENV=development
RELAY_API_KEY=local-dev-api-key

# Database
DATABASE_URL=mysql://root:<PASSWORD>@localhost:3306/msq_relayer

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_TTL=300

# Queue
AWS_REGION=ap-northeast-2
SQS_QUEUE_URL=http://localhost:4566/000000000000/relay-transactions
SQS_DLQ_URL=http://localhost:4566/000000000000/relay-transactions-dlq
SQS_ENDPOINT_URL=http://localhost:4566  # LocalStack only
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test

# OZ Relayer
OZ_RELAYER_URL=http://localhost:8081
OZ_RELAYER_API_KEY=relayer-api-key
```

### queue-consumer Configuration

```bash
# Core
NODE_ENV=development

# Database
DATABASE_URL=mysql://root:<PASSWORD>@localhost:3306/msq_relayer

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Queue
AWS_REGION=ap-northeast-2
SQS_QUEUE_URL=http://localhost:4566/000000000000/relay-transactions
SQS_DLQ_URL=http://localhost:4566/000000000000/relay-transactions-dlq
SQS_ENDPOINT_URL=http://localhost:4566  # LocalStack only
SQS_VISIBILITY_TIMEOUT=60
SQS_WAIT_TIME_SECONDS=20
SQS_MAX_RECEIVE_COUNT=3
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test

# OZ Relayer
OZ_RELAYER_URL=http://localhost:8081
OZ_RELAYER_API_KEY=relayer-api-key
```

---

## Docker Deployment

### Build Images

```bash
# Build all images
docker compose build

# Build specific service
docker compose build relay-api
docker compose build queue-consumer

# Build with no cache
docker compose build --no-cache
```

### Start Services

```bash
# Start in detached mode
docker compose up -d

# View logs
docker compose logs -f

# View specific service logs
docker compose logs -f relay-api
docker compose logs -f queue-consumer
docker compose logs -f localstack

# Stop services
docker compose down

# Stop and remove volumes
docker compose down -v
```

### Health Checks

```bash
# Check service status
docker compose ps

# API Gateway health
curl http://localhost:3000/api/v1/health

# OZ Relayer health
curl http://localhost:8081/api/v1/health

# Redis
docker compose exec redis redis-cli ping

# MySQL
docker compose exec mysql mysql -u root -p -e "SELECT 1"

# LocalStack SQS
docker compose exec localstack awslocal sqs list-queues
```

---

## Database Setup

### Create Database

```bash
# Using docker-compose (pre-created)
# MySQL service automatically creates msq_relayer database

# Verify
docker compose exec mysql mysql -u root -p \
  -e "SHOW DATABASES LIKE 'msq_relayer';"
```

### Run Migrations

```bash
# Run all pending migrations
pnpm --filter @msq-relayer/relay-api run prisma:migrate:deploy

# Dev mode with prompt
pnpm --filter @msq-relayer/relay-api run prisma:migrate:dev

# Generate Prisma client
pnpm --filter @msq-relayer/relay-api run prisma:generate

# View database
pnpm --filter @msq-relayer/relay-api run prisma:studio
```

### Schema

```sql
-- File: packages/relay-api/prisma/schema.prisma

model Transaction {
  id            String    @id @default(uuid())
  type          String?   // 'direct' | 'gasless'
  status        String    // 'pending' | 'success' | 'failed'
  request       Json?     // Original request
  result        Json?     // OZ Relayer response
  error_message String?   @db.Text
  hash          String?
  createdAt     DateTime  @default(now())
  confirmedAt   DateTime?
  updatedAt     DateTime  @updatedAt

  @@index([status])
  @@index([type])
  @@index([createdAt])
}
```

---

## Production Deployment (AWS ECS)

### Prerequisites

- AWS Account with ECR access
- ECS Cluster
- RDS MySQL instance
- ElastiCache Redis cluster
- SQS Queues (relay-transactions, relay-transactions-dlq)
- IAM roles configured

### Build and Push to ECR

```bash
# Login to ECR
aws ecr get-login-password --region ap-northeast-2 | \
  docker login --username AWS --password-stdin <ECR_REGISTRY>

# Tag images
docker tag relay-api:latest <ECR_REGISTRY>/relay-api:latest
docker tag queue-consumer:latest <ECR_REGISTRY>/queue-consumer:latest

# Push to ECR
docker push <ECR_REGISTRY>/relay-api:latest
docker push <ECR_REGISTRY>/queue-consumer:latest
```

### ECS Task Definition (relay-api)

```json
{
  "family": "relay-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::ACCOUNT:role/relay-api-task-role",
  "containerDefinitions": [
    {
      "name": "relay-api",
      "image": "ECR_REGISTRY/relay-api:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "hostPort": 3000,
          "protocol": "tcp"
        }
      ],
      "essential": true,
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        },
        {
          "name": "PORT",
          "value": "3000"
        },
        {
          "name": "AWS_REGION",
          "value": "ap-northeast-2"
        },
        {
          "name": "SQS_QUEUE_URL",
          "value": "https://sqs.ap-northeast-2.amazonaws.com/ACCOUNT-ID/relay-transactions"
        },
        {
          "name": "SQS_DLQ_URL",
          "value": "https://sqs.ap-northeast-2.amazonaws.com/ACCOUNT-ID/relay-transactions-dlq"
        },
        {
          "name": "OZ_RELAYER_URL",
          "value": "http://oz-relayer-internal:8080"
        }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:ap-northeast-2:ACCOUNT:secret:relay-api/database-url"
        },
        {
          "name": "RELAY_API_KEY",
          "valueFrom": "arn:aws:secretsmanager:ap-northeast-2:ACCOUNT:secret:relay-api/api-key"
        },
        {
          "name": "REDIS_HOST",
          "valueFrom": "arn:aws:secretsmanager:ap-northeast-2:ACCOUNT:secret:relay-api/redis-host"
        },
        {
          "name": "OZ_RELAYER_API_KEY",
          "valueFrom": "arn:aws:secretsmanager:ap-northeast-2:ACCOUNT:secret:relay-api/oz-key"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/relay-api",
          "awslogs-region": "ap-northeast-2",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:3000/api/v1/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3
      }
    }
  ]
}
```

### ECS Task Definition (queue-consumer)

```json
{
  "family": "queue-consumer",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::ACCOUNT:role/queue-consumer-task-role",
  "containerDefinitions": [
    {
      "name": "queue-consumer",
      "image": "ECR_REGISTRY/queue-consumer:latest",
      "essential": true,
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        },
        {
          "name": "AWS_REGION",
          "value": "ap-northeast-2"
        },
        {
          "name": "SQS_QUEUE_URL",
          "value": "https://sqs.ap-northeast-2.amazonaws.com/ACCOUNT-ID/relay-transactions"
        },
        {
          "name": "SQS_DLQ_URL",
          "value": "https://sqs.ap-northeast-2.amazonaws.com/ACCOUNT-ID/relay-transactions-dlq"
        },
        {
          "name": "SQS_VISIBILITY_TIMEOUT",
          "value": "60"
        },
        {
          "name": "SQS_WAIT_TIME_SECONDS",
          "value": "20"
        },
        {
          "name": "OZ_RELAYER_URL",
          "value": "http://oz-relayer-internal:8080"
        }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:ap-northeast-2:ACCOUNT:secret:queue-consumer/database-url"
        },
        {
          "name": "REDIS_HOST",
          "valueFrom": "arn:aws:secretsmanager:ap-northeast-2:ACCOUNT:secret:queue-consumer/redis-host"
        },
        {
          "name": "OZ_RELAYER_API_KEY",
          "valueFrom": "arn:aws:secretsmanager:ap-northeast-2:ACCOUNT:secret:queue-consumer/oz-key"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/queue-consumer",
          "awslogs-region": "ap-northeast-2",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

### IAM Task Role Policy (relay-api)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:GetQueueUrl",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:ap-northeast-2:ACCOUNT:relay-transactions"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:ap-northeast-2:ACCOUNT:log-group:/ecs/relay-api:*"
    }
  ]
}
```

### IAM Task Role Policy (queue-consumer)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:ChangeMessageVisibility"
      ],
      "Resource": [
        "arn:aws:sqs:ap-northeast-2:ACCOUNT:relay-transactions",
        "arn:aws:sqs:ap-northeast-2:ACCOUNT:relay-transactions-dlq"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:ap-northeast-2:ACCOUNT:log-group:/ecs/queue-consumer:*"
    }
  ]
}
```

### ECS Service (relay-api)

```bash
# Create service
aws ecs create-service \
  --cluster relay-cluster \
  --service-name relay-api \
  --task-definition relay-api:1 \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-xxx],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=relay-api,containerPort=3000" \
  --region ap-northeast-2

# Auto-scaling
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/relay-cluster/relay-api \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 10 \
  --region ap-northeast-2

# Scaling policy (CPU-based)
aws application-autoscaling put-scaling-policy \
  --policy-name relay-api-cpu-scaling \
  --service-namespace ecs \
  --resource-id service/relay-cluster/relay-api \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration "TargetValue=70.0,PredefinedMetricSpecification={PredefinedMetricType=ECSServiceAverageCPUUtilization}" \
  --region ap-northeast-2
```

### ECS Service (queue-consumer)

```bash
# Create service
aws ecs create-service \
  --cluster relay-cluster \
  --service-name queue-consumer \
  --task-definition queue-consumer:1 \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-xxx],assignPublicIp=DISABLED}" \
  --region ap-northeast-2

# Auto-scaling based on SQS queue depth
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/relay-cluster/queue-consumer \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 1 \
  --max-capacity 20 \
  --region ap-northeast-2

# Custom metric scaling (SQS queue depth)
aws application-autoscaling put-scaling-policy \
  --policy-name queue-consumer-queue-depth \
  --service-namespace ecs \
  --resource-id service/relay-cluster/queue-consumer \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration \
    "TargetValue=100.0,CustomizedMetricSpecification={MetricName=ApproximateNumberOfMessagesVisible,Namespace=AWS/SQS,Statistic=Average}" \
  --region ap-northeast-2
```

---

## Monitoring & Logging

### CloudWatch Logs

```bash
# View relay-api logs
aws logs tail /ecs/relay-api --follow

# View queue-consumer logs
aws logs tail /ecs/queue-consumer --follow

# Search for errors
aws logs filter-log-events \
  --log-group-name /ecs/queue-consumer \
  --filter-pattern "ERROR"
```

### CloudWatch Alarms

```bash
# High queue depth
aws cloudwatch put-metric-alarm \
  --alarm-name sqs-high-queue-depth \
  --alarm-description "Alert when SQS queue depth > 1000" \
  --metric-name ApproximateNumberOfMessagesVisible \
  --namespace AWS/SQS \
  --statistic Average \
  --period 300 \
  --threshold 1000 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions "arn:aws:sns:ap-northeast-2:ACCOUNT:alert-topic"

# Consumer lag
aws cloudwatch put-metric-alarm \
  --alarm-name consumer-lag-high \
  --alarm-description "Alert when consumer lag > 5 minutes" \
  --metric-name ConsumerLag \
  --namespace Custom/RelayConsumer \
  --statistic Average \
  --period 60 \
  --threshold 300 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions "arn:aws:sns:ap-northeast-2:ACCOUNT:alert-topic"
```

---

## Troubleshooting

### relay-api Issues

```bash
# Check logs
docker compose logs relay-api

# Check health
curl http://localhost:3000/api/v1/health

# Test SQS connection
docker compose exec relay-api npm run test:sqs
```

### queue-consumer Issues

```bash
# Check logs
docker compose logs queue-consumer

# Check SQS queue depth
docker compose exec localstack awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/relay-transactions \
  --attribute-names ApproximateNumberOfMessages

# Check DLQ for failed messages
docker compose exec localstack awslocal sqs receive-message \
  --queue-url http://localhost:4566/000000000000/relay-transactions-dlq
```

### Database Connection

```bash
# Verify MySQL is running
docker compose ps mysql

# Test connection
docker compose exec mysql mysql -u root -p \
  -e "SELECT 1"

# Check migrations
docker compose exec relay-api npm run prisma:status
```

---

## Multi-Relayer Configuration (SPEC-ROUTING-001)

### Overview

The system supports 3 OZ Relayer instances with separate configurations for load distribution and failover.

### Environment Variables

Each OZ Relayer instance requires unique REDIS_KEY_PREFIX to isolate cache data:

#### Relayer 1

```bash
REDIS_KEY_PREFIX=relayer-1
OZ_RELAYER_API_URL=http://oz-relayer-1:8080
OZ_RELAYER_SIGNING_KEY=docker/keys/relayer-1/key1.json
OZ_RELAYER_ID=relayer-1
```

#### Relayer 2

```bash
REDIS_KEY_PREFIX=relayer-2
OZ_RELAYER_API_URL=http://oz-relayer-2:8080
OZ_RELAYER_SIGNING_KEY=docker/keys/relayer-2/key2.json
OZ_RELAYER_ID=relayer-2
```

#### Relayer 3

```bash
REDIS_KEY_PREFIX=relayer-3
OZ_RELAYER_API_URL=http://oz-relayer-3:8080
OZ_RELAYER_SIGNING_KEY=docker/keys/relayer-3/key3.json
OZ_RELAYER_ID=relayer-3
```

### Docker Compose Configuration

```yaml
# docker/docker-compose.yaml

oz-relayer-1:
  image: oz-relayer:latest
  container_name: oz-relayer-1
  ports:
    - "8081:8080"
  environment:
    REDIS_KEY_PREFIX: relayer-1
    OZ_RELAYER_API_URL: http://oz-relayer-1:8080
    OZ_RELAYER_ID: relayer-1
    # ... other config
  volumes:
    - ./config/oz-relayer/relayer-1.json:/app/config.json
    - ./keys/relayer-1:/app/keys:ro
  depends_on:
    - redis
    - mysql

oz-relayer-2:
  image: oz-relayer:latest
  container_name: oz-relayer-2
  ports:
    - "8082:8080"
  environment:
    REDIS_KEY_PREFIX: relayer-2
    OZ_RELAYER_API_URL: http://oz-relayer-2:8080
    OZ_RELAYER_ID: relayer-2
  volumes:
    - ./config/oz-relayer/relayer-2.json:/app/config.json
    - ./keys/relayer-2:/app/keys:ro
  depends_on:
    - redis
    - mysql

oz-relayer-3:
  image: oz-relayer:latest
  container_name: oz-relayer-3
  ports:
    - "8083:8080"
  environment:
    REDIS_KEY_PREFIX: relayer-3
    OZ_RELAYER_API_URL: http://oz-relayer-3:8080
    OZ_RELAYER_ID: relayer-3
  volumes:
    - ./config/oz-relayer/relayer-3.json:/app/config.json
    - ./keys/relayer-3:/app/keys:ro
  depends_on:
    - redis
    - mysql
```

### Consumer Configuration

The queue-consumer must be aware of all 3 relayer instances:

```bash
# packages/queue-consumer/.env

# Relayer URLs (comma-separated)
OZ_RELAYER_URLS=http://oz-relayer-1:8080,http://oz-relayer-2:8080,http://oz-relayer-3:8080

# Smart Routing Configuration
SMART_ROUTING_ENABLED=true
HEALTH_CHECK_TIMEOUT_MS=500
HEALTH_CHECK_CACHE_TTL_SECONDS=10

# Round-Robin Fallback
FALLBACK_MODE=round-robin
```

### Port Mapping

| Relayer | Container Port | Host Port | URL |
|---------|----------------|-----------|-----|
| relayer-1 | 8080 | 8081 | http://oz-relayer-1:8080 |
| relayer-2 | 8080 | 8082 | http://oz-relayer-2:8080 |
| relayer-3 | 8080 | 8083 | http://oz-relayer-3:8080 |

### Health Check Verification

```bash
# Check health of all 3 relayers
curl http://localhost:8081/health
curl http://localhost:8082/health
curl http://localhost:8083/health

# Expected response
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600
}

# Check pending transaction count
curl http://localhost:8081/api/v1/relayers/relayer-1/pending_txs
curl http://localhost:8082/api/v1/relayers/relayer-2/pending_txs
curl http://localhost:8083/api/v1/relayers/relayer-3/pending_txs
```

### Redis Key Isolation

Each relayer uses unique Redis key prefix to avoid conflicts:

```bash
# Relayer 1 keys
KEYS relayer-1:*     # health:relayer-1, pending_txs:relayer-1, etc.

# Relayer 2 keys
KEYS relayer-2:*     # health:relayer-2, pending_txs:relayer-2, etc.

# Relayer 3 keys
KEYS relayer-3:*     # health:relayer-3, pending_txs:relayer-3, etc.

# Check cache in redis-cli
redis-cli
> KEYS relayer-*
> GET relayer-1:health
> GET relayer-2:health
```

### Smart Routing in Production

Configure smart routing parameters in queue-consumer:

```typescript
// packages/queue-consumer/src/relay/relayer-router.service.ts

const RELAYER_SELECTION_CONFIG = {
  // Health check configuration
  healthCheckTimeoutMs: process.env.HEALTH_CHECK_TIMEOUT_MS || 500,
  healthCheckCacheTtlSeconds: process.env.HEALTH_CHECK_CACHE_TTL_SECONDS || 10,

  // Selection strategy
  selectionStrategy: 'least-pending-tx', // or 'round-robin', 'weighted'

  // Fallback behavior
  fallbackMode: process.env.FALLBACK_MODE || 'round-robin',

  // Performance target
  performanceTargetMs: 100, // 95th percentile selection time
};
```

---

## Summary

Deployment Guide covers:

- ✅ Local development with Docker
- ✅ Environment variable configuration
- ✅ Database setup and migrations
- ✅ Production AWS ECS deployment
- ✅ IAM role configuration
- ✅ Auto-scaling setup
- ✅ CloudWatch monitoring
- ✅ Troubleshooting guides

For complete technical specifications, see [SPEC-QUEUE-001](./../.moai/specs/SPEC-QUEUE-001/spec.md).
