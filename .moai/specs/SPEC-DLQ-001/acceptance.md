# SPEC-DLQ-001 Acceptance Criteria

## Overview

Acceptance criteria for Dead Letter Queue (DLQ) handling and error classification system.

**Test Framework**: Jest + LocalStack (Supertest for relay-api HTTP endpoints only)
**Coverage Target**: ≥90%
**E2E Environment**: LocalStack SQS

---

## AC-1: Error Classification

### AC-1.1: Non-Retryable Error - Insufficient Funds

**Given**: A transaction with "insufficient funds" error
**When**: Consumer processes the message
**Then**:
- Transaction status is set to 'failed'
- Error message contains "[NON_RETRYABLE]"
- SQS message is deleted immediately
- Message does NOT move to DLQ
- Log contains "[NON_RETRYABLE] Pattern match"

**Test Code**:
```typescript
it('should immediately fail transaction with insufficient funds', async () => {
  // Arrange
  const error = new Error('insufficient funds for gas');

  // Act
  const category = errorClassifier.classify(error);

  // Assert
  expect(category).toBe(ErrorCategory.NON_RETRYABLE);
});
```

### AC-1.2: Non-Retryable Error - Gas Issues

**Given**: A transaction with gas-related error
**When**: Consumer processes the message
**Then**:
- Transaction status is set to 'failed'
- SQS message is deleted
- No retry occurs

**Error Patterns**:
- "gas required exceeds allowance"
- "intrinsic gas too low"
- "out of gas"

### AC-1.3: Non-Retryable Error - Nonce Issues

**Given**: A transaction with nonce error
**When**: Consumer processes the message
**Then**:
- Transaction status is set to 'failed'
- SQS message is deleted
- No retry occurs

**Error Patterns**:
- "nonce too low"
- "nonce already used"

### AC-1.4: Non-Retryable Error - Execution Revert

**Given**: A transaction with contract revert
**When**: Consumer processes the message
**Then**:
- Transaction status is set to 'failed'
- SQS message is deleted
- No retry occurs

**Error Patterns**:
- "execution reverted"
- "transaction would revert"

### AC-1.5: Non-Retryable Error - HTTP Client Errors

**Given**: An error with HTTP 400/401/403/422 status code
**When**: Consumer processes the message
**Then**:
- Transaction status is set to 'failed'
- SQS message is deleted
- No retry occurs

**Test Code**:
```typescript
it('should classify HTTP 400 as non-retryable', async () => {
  // Arrange
  const error = { message: 'Bad Request', response: { status: 400 } };

  // Act
  const category = errorClassifier.classify(error);

  // Assert
  expect(category).toBe(ErrorCategory.NON_RETRYABLE);
});
```

### AC-1.6: Retryable Error - Network Timeout

**Given**: A transaction with network timeout
**When**: Consumer processes the message
**Then**:
- Error is thrown (not caught)
- SQS retries the message (up to maxReceiveCount: 3)
- After 3 failures, message moves to DLQ
- Log contains "[RETRYABLE] Pattern match"

**Test Code**:
```typescript
it('should classify network timeout as retryable', async () => {
  // Arrange
  const error = new Error('network timeout');

  // Act
  const category = errorClassifier.classify(error);

  // Assert
  expect(category).toBe(ErrorCategory.RETRYABLE);
});
```

### AC-1.7: Retryable Error - HTTP Server Errors

**Given**: An error with HTTP 500/502/503/504 status code
**When**: Consumer processes the message
**Then**:
- Error is thrown
- SQS retries up to 3 times
- After 3 failures, message moves to DLQ

**Test Code**:
```typescript
it('should classify HTTP 503 as retryable', async () => {
  // Arrange
  const error = { message: 'Service Unavailable', response: { status: 503 } };

  // Act
  const category = errorClassifier.classify(error);

  // Assert
  expect(category).toBe(ErrorCategory.RETRYABLE);
});
```

### AC-1.8: Default Classification

**Given**: An unknown error pattern
**When**: Consumer classifies the error
**Then**:
- Error is classified as RETRYABLE (conservative approach)
- Log contains "[RETRYABLE] Default classification"

---

## AC-2: retryOnFailure Field

### AC-2.1: Schema Migration

**Given**: Existing database without retryOnFailure field
**When**: Migration is applied
**Then**:
- Transaction table has `retryOnFailure` column
- Column type is Boolean (nullable)
- Default value is false
- Existing transactions have retryOnFailure=false (backfilled)

**Test Code**:
```bash
# Run migration
pnpm --filter @msq-relayer/relay-api prisma migrate dev

# Verify backfill
SELECT COUNT(*) FROM Transaction WHERE retryOnFailure IS NULL;
# Expected: 0 (all records have been backfilled)

# Verify schema
pnpm --filter @msq-relayer/relay-api prisma db pull
```

### AC-2.2: API Request with retryOnFailure

**Given**: A POST request to /relay/direct endpoint
**When**: Request includes `retryOnFailure: true`
**Then**:
- Transaction is created with retryOnFailure=true
- SQS message includes retryOnFailure=true
- Consumer stores retryOnFailure=true in DB

**Test Code**:
```typescript
it('should accept retryOnFailure in request', async () => {
  // Arrange
  const requestDto = {
    to: '0x123...',
    data: '0x...',
    retryOnFailure: true,
  };

  // Act
  const response = await request(app.getHttpServer())
    .post('/relay/direct')
    .send(requestDto);

  // Assert
  expect(response.status).toBe(201);
  const transaction = await prisma.transaction.findUnique({
    where: { id: response.body.id },
  });
  expect(transaction.retryOnFailure).toBe(true);
});
```

### AC-2.3: Backwards Compatibility

**Given**: A POST request WITHOUT retryOnFailure field
**When**: Request is processed
**Then**:
- Transaction is created successfully
- retryOnFailure defaults to false
- No errors occur (backwards compatible)

**Test Code**:
```typescript
it('should default retryOnFailure to false when not provided', async () => {
  // Arrange
  const requestDto = {
    to: '0x123...',
    data: '0x...',
    // No retryOnFailure field
  };

  // Act
  const response = await request(app.getHttpServer())
    .post('/relay/direct')
    .send(requestDto);

  // Assert
  expect(response.status).toBe(201);
  const transaction = await prisma.transaction.findUnique({
    where: { id: response.body.id },
  });
  expect(transaction.retryOnFailure).toBe(false);
});
```

---

## AC-3: DLQ Consumer

### AC-3.1: Both Consumers Start Together

**Given**: Application is starting
**When**: Bootstrap process completes
**Then**:
- Main Consumer service starts
- DLQ Consumer service starts
- Log contains "Starting Main Consumer and DLQ Consumer together"
- Log contains "DLQ Consumer started"
- Polling interval is 10000ms (10 seconds)

**Test Code**:
```typescript
it('should start both consumers together', async () => {
  // Act
  const app = await NestFactory.create(ConsumerModule);
  await app.init();

  // Assert
  // Verify both consumers are running
  expect(loggerSpy).toHaveBeenCalledWith(
    expect.stringContaining('Starting Main Consumer and DLQ Consumer together')
  );
  expect(loggerSpy).toHaveBeenCalledWith(
    expect.stringContaining('DLQ Consumer started')
  );
});
```

### AC-3.2: DLQ Message Processing - Immediate Failure

**Given**: A message in DLQ with retryOnFailure=false
**When**: DLQ Consumer polls the queue
**Then**:
- Message is received
- Transaction is found in DB
- Transaction status is checked for idempotency
- Transaction status is updated to 'failed'
- Error message contains "[DLQ] Message moved to DLQ after 3 retries"
- DLQ message is deleted
- Log contains "DLQ message processed: {id} -> failed"

**Test Code**:
```typescript
it('should process DLQ message and mark as failed', async () => {
  // Arrange
  const transaction = await prisma.transaction.create({
    data: {
      id: 'tx-123',
      retryOnFailure: false,
      status: 'pending',
    },
  });
  const dlqMessage = {
    Body: JSON.stringify({ transactionId: 'tx-123' }),
    ReceiptHandle: 'receipt-123',
  };
  sqsAdapter.receiveMessages.mockResolvedValue([dlqMessage]);

  // Act
  await dlqConsumer.processDlqBatch();

  // Assert
  const updated = await prisma.transaction.findUnique({
    where: { id: 'tx-123' },
  });
  expect(updated.status).toBe('failed');
  expect(updated.error_message).toContain('[DLQ]');
  expect(sqsAdapter.deleteMessage).toHaveBeenCalledWith(
    dlqUrl,
    'receipt-123'
  );
});
```

### AC-3.3: DLQ Message Processing - Retry Request

**Given**: A message in DLQ with retryOnFailure=true
**When**: DLQ Consumer polls the queue
**Then**:
- Message is received
- Log contains "Retry requested but not implemented"
- Transaction status is updated to 'failed' (current behavior)
- DLQ message is deleted
- **Note**: Retry logic will be implemented in future

**Test Code**:
```typescript
it('should log warning for retry requests', async () => {
  // Arrange
  const transaction = await prisma.transaction.create({
    data: {
      id: 'tx-456',
      retryOnFailure: true,
      status: 'pending',
    },
  });
  const dlqMessage = {
    Body: JSON.stringify({ transactionId: 'tx-456' }),
    ReceiptHandle: 'receipt-456',
  };
  sqsAdapter.receiveMessages.mockResolvedValue([dlqMessage]);

  // Act
  await dlqConsumer.processDlqBatch();

  // Assert
  expect(loggerSpy).toHaveBeenCalledWith(
    expect.stringContaining('Retry requested but not implemented')
  );
});
```

### AC-3.4: DLQ Message - Transaction Not Found

**Given**: A DLQ message with transactionId that doesn't exist in DB
**When**: DLQ Consumer polls the queue
**Then**:
- Log contains "Transaction not found: {id}, deleting DLQ message"
- DLQ message is deleted
- No error is thrown

**Test Code**:
```typescript
it('should delete DLQ message when transaction not found', async () => {
  // Arrange
  const dlqMessage = {
    Body: JSON.stringify({ transactionId: 'non-existent' }),
    ReceiptHandle: 'receipt-789',
  };
  sqsAdapter.receiveMessages.mockResolvedValue([dlqMessage]);

  // Act
  await dlqConsumer.processDlqBatch();

  // Assert
  expect(loggerSpy).toHaveBeenCalledWith(
    expect.stringContaining('Transaction not found')
  );
  expect(sqsAdapter.deleteMessage).toHaveBeenCalledWith(
    dlqUrl,
    'receipt-789'
  );
});
```

### AC-3.5: DLQ Consumer Polling Interval

**Given**: DLQ_POLL_INTERVAL_MS=10000 environment variable
**When**: DLQ Consumer is running
**Then**:
- Polling occurs every 10 seconds
- SQS receiveMessages is called with waitTimeSeconds=10
- Batch size is 10 messages

**Test Code**:
```typescript
it('should poll DLQ every 10 seconds', async () => {
  // Arrange
  jest.useFakeTimers();
  sqsAdapter.receiveMessages.mockResolvedValue([]);

  // Act
  dlqConsumer.onModuleInit();
  jest.advanceTimersByTime(10000);

  // Assert
  expect(sqsAdapter.receiveMessages).toHaveBeenCalledWith(
    dlqUrl,
    10,
    { waitTimeSeconds: 10 }
  );
});
```

### AC-3.6: DLQ Consumer Graceful Shutdown

**Given**: DLQ Consumer is running
**When**: Application receives shutdown signal
**Then**:
- `onModuleDestroy()` is called
- `isRunning` is set to false
- Polling loop exits gracefully
- Log contains "DLQ Consumer stopped"

**Test Code**:
```typescript
it('should stop polling on module destroy', async () => {
  // Arrange
  dlqConsumer.onModuleInit();

  // Act
  await dlqConsumer.onModuleDestroy();

  // Assert
  expect(loggerSpy).toHaveBeenCalledWith('DLQ Consumer stopped');
  // Verify polling loop has stopped
});
```

### AC-3.7: DLQ Message Idempotency

**Given**: A DLQ message for a transaction already marked as 'failed'
**When**: DLQ Consumer polls the queue
**Then**:
- Transaction status is checked
- Status is already 'failed', no update occurs
- DLQ message is deleted
- Log contains "Transaction already failed: {id}, deleting duplicate DLQ message"

**Test Code**:
```typescript
it('should handle duplicate DLQ messages idempotently', async () => {
  // Arrange
  const transaction = await prisma.transaction.create({
    data: {
      id: 'tx-789',
      retryOnFailure: false,
      status: 'failed', // Already failed
    },
  });
  const dlqMessage = {
    Body: JSON.stringify({ transactionId: 'tx-789' }),
    ReceiptHandle: 'receipt-789',
  };
  sqsAdapter.receiveMessages.mockResolvedValue([dlqMessage]);

  // Act
  await dlqConsumer.processDlqBatch();

  // Assert
  expect(loggerSpy).toHaveBeenCalledWith(
    expect.stringContaining('Transaction already failed')
  );
  expect(sqsAdapter.deleteMessage).toHaveBeenCalledWith(
    dlqUrl,
    'receipt-789'
  );
  // Verify no DB update occurred
});
```

---

## AC-4: Integration Tests

### AC-4.1: End-to-End Retryable Error Flow

**Given**: A transaction that will fail with retryable error
**When**: Message is sent to SQS queue
**Then**:
1. Consumer attempts processing (1st attempt)
2. Error is classified as RETRYABLE
3. Error is thrown, SQS retries (2nd attempt)
4. Error is thrown, SQS retries (3rd attempt)
5. After 3 failures, message moves to DLQ
6. DLQ Consumer picks up message
7. Transaction is marked as failed
8. DLQ message is deleted

**Test Code**:
```typescript
it('should handle full retryable error flow', async () => {
  // Arrange
  const transaction = await createTestTransaction();
  const message = createSqsMessage(transaction);
  ozRelayerClient.sendTransaction.mockRejectedValue(
    new Error('network timeout') // Retryable
  );

  // Act - Send to main queue
  await sqsAdapter.sendMessage(queueUrl, message);

  // Wait for SQS retry logic to complete (3 attempts)
  await wait(10000); // 10 seconds

  // Assert - Check DLQ
  const dlqMessages = await sqsAdapter.receiveMessages(dlqUrl, 10);
  expect(dlqMessages).toHaveLength(1);

  // Wait for DLQ Consumer to process
  await wait(12000); // 12 seconds (poll interval + processing)

  // Assert - Transaction failed
  const updated = await prisma.transaction.findUnique({
    where: { id: transaction.id },
  });
  expect(updated.status).toBe('failed');

  // Assert - DLQ message deleted
  const remainingMessages = await sqsAdapter.receiveMessages(dlqUrl, 10);
  expect(remainingMessages).toHaveLength(0);
});
```

### AC-4.2: End-to-End Non-Retryable Error Flow

**Given**: A transaction that will fail with non-retryable error
**When**: Message is sent to SQS queue
**Then**:
1. Consumer attempts processing
2. Error is classified as NON_RETRYABLE
3. Transaction is immediately marked as failed
4. SQS message is deleted
5. Message does NOT move to DLQ

**Test Code**:
```typescript
it('should handle non-retryable error without DLQ', async () => {
  // Arrange
  const transaction = await createTestTransaction();
  const message = createSqsMessage(transaction);
  ozRelayerClient.sendTransaction.mockRejectedValue(
    new Error('insufficient funds') // Non-retryable
  );

  // Act - Send to main queue
  await sqsAdapter.sendMessage(queueUrl, message);

  // Wait for processing
  await wait(2000); // 2 seconds

  // Assert - Transaction failed immediately
  const updated = await prisma.transaction.findUnique({
    where: { id: transaction.id },
  });
  expect(updated.status).toBe('failed');
  expect(updated.error_message).toContain('[NON_RETRYABLE]');

  // Assert - No DLQ message
  const dlqMessages = await sqsAdapter.receiveMessages(dlqUrl, 10);
  expect(dlqMessages).toHaveLength(0);
});
```

---

## AC-5: Performance and Reliability

### AC-5.1: DLQ Processing Latency

**Given**: A message in DLQ
**When**: DLQ Consumer is running
**Then**:
- Message is processed within 20 seconds (2x poll interval)
- 95th percentile latency < 20 seconds

### AC-5.2: Error Classification Performance

**Given**: 1000 errors to classify
**When**: ErrorClassifierService processes them
**Then**:
- Error classification runs in O(1) time (constant time complexity)
- Pattern matching uses efficient regex compilation
- No noticeable performance degradation

**Rationale**: Error classification is a simple pattern matching operation against a fixed set of regex patterns. Performance optimization is achieved through efficient regex compilation, not arbitrary time benchmarks.

### AC-5.3: Zero Message Loss

**Given**: 100 transactions with various error types
**When**: System processes all transactions
**Then**:
- All failed transactions have final status in DB
- No messages remain in DLQ indefinitely
- No messages are lost during processing

---

## AC-6: Monitoring and Logging

### AC-6.1: Error Classification Logs

**Given**: Any error occurs
**When**: Error is classified
**Then**:
- Log includes category: "[RETRYABLE]" or "[NON_RETRYABLE]"
- Log includes error message
- Log level is appropriate (warn for non-retryable, log for retryable)

### AC-6.2: DLQ Consumer Logs

**Given**: DLQ Consumer is processing messages
**When**: Messages are processed
**Then**:
- Log includes "Received N DLQ messages"
- Log includes "DLQ message processed: {id} -> failed"
- Errors include full stack trace

---

## Test Coverage Requirements

### Unit Tests
- ErrorClassifierService: ≥95% coverage
- DlqConsumerService: ≥90% coverage
- MainConsumerService: ≥90% coverage

### Integration Tests
- Full error flow coverage: 100%
- Edge cases: 100%

### E2E Tests
- LocalStack SQS integration: 100% success rate
- Performance tests: Pass latency requirements

---

## Acceptance Sign-Off

- [ ] All unit tests pass (≥90% coverage)
- [ ] All integration tests pass
- [ ] All E2E tests pass with LocalStack
- [ ] Error classification accuracy verified
- [ ] DLQ message deletion verified
- [ ] Backwards compatibility verified
- [ ] Performance requirements met
- [ ] Logs are comprehensive and useful
- [ ] Documentation is complete

**Sign-off**: Ready for production deployment when all checkboxes are completed.
