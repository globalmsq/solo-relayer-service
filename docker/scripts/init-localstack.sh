#!/bin/bash
# LocalStack SQS Queue Initialization Script
# Creates SQS queues with Dead Letter Queue (DLQ) redrive policy
# SPEC-QUEUE-001: AWS SQS 비동기 트랜잭션 큐 시스템

set -e

echo "Initializing SQS queues for LocalStack..."
export AWS_DEFAULT_REGION=ap-northeast-2

# Wait for LocalStack to be ready
for i in {1..30}; do
  if curl -s http://localhost:4566/_localstack/health > /dev/null; then
    echo "LocalStack is ready"
    break
  fi
  echo "Waiting for LocalStack... ($i/30)"
  sleep 1
done

# Create DLQ first
echo "Creating DLQ: relay-transactions-dlq"
awslocal sqs create-queue \
  --queue-name relay-transactions-dlq \
  --endpoint-url http://localhost:4566 \
  2>/dev/null || echo "DLQ already exists"

# Get DLQ ARN
echo "Retrieving DLQ ARN..."
DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/relay-transactions-dlq \
  --attribute-names QueueArn \
  --endpoint-url http://localhost:4566 \
  --query 'Attributes.QueueArn' \
  --output text)

echo "DLQ ARN: $DLQ_ARN"

# Create main queue with DLQ redrive policy
echo "Creating main queue: relay-transactions"
awslocal sqs create-queue \
  --queue-name relay-transactions \
  --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}" \
  --endpoint-url http://localhost:4566 \
  2>/dev/null || echo "Main queue already exists"

# Set Visibility Timeout to 60 seconds
echo "Configuring queue attributes..."
awslocal sqs set-queue-attributes \
  --queue-url http://localhost:4566/000000000000/relay-transactions \
  --attributes VisibilityTimeout=60 \
  --endpoint-url http://localhost:4566 \
  2>/dev/null || echo "Attributes already set"

# List created queues
echo "SQS queues created successfully!"
awslocal sqs list-queues --endpoint-url http://localhost:4566
