import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DlqConsumerService } from './dlq-consumer.service';
import { SqsAdapter } from '../sqs/sqs.adapter';
import { PrismaService } from '../prisma/prisma.service';

/**
 * DlqConsumerService Unit Tests
 *
 * SPEC-DLQ-001: Dead Letter Queue Processing
 *
 * Tests cover:
 * - E-4: Polling at 10-second intervals
 * - E-5: retryOnFailure flag handling
 * - E-6: Idempotency (skip already failed transactions)
 * - U-2: Always delete DLQ messages after processing
 * - U-5: Check transaction status before processing
 * - S-2/S-3: isRunning state management
 */
describe('DlqConsumerService', () => {
  let service: DlqConsumerService;
  let sqsAdapter: jest.Mocked<SqsAdapter>;
  let prismaService: jest.Mocked<PrismaService>;

  const mockDlqUrl = 'http://localhost:4566/000000000000/relay-transactions-dlq';
  const mockTransactionId = '550e8400-e29b-12d3-a456-426614174000';

  const createMockMessage = (
    transactionId: string,
    retryOnFailure?: boolean,
  ) => ({
    MessageId: 'msg-1',
    Body: JSON.stringify({
      transactionId,
      type: 'direct',
      request: { to: '0x123', data: '0x' },
      retryOnFailure,
    }),
    ReceiptHandle: 'receipt-1',
  });

  beforeEach(async () => {
    const mockSqsAdapter = {
      receiveMessages: jest.fn().mockResolvedValue([]),
      deleteMessage: jest.fn().mockResolvedValue(undefined),
    };

    const mockPrismaService = {
      transaction: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          'sqs.dlqUrl': mockDlqUrl,
          'dlqConsumer.pollIntervalMs': 10000,
          'dlqConsumer.waitTimeSeconds': 10,
          'dlqConsumer.maxNumberOfMessages': 10,
        };
        return config[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DlqConsumerService,
        { provide: SqsAdapter, useValue: mockSqsAdapter },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<DlqConsumerService>(DlqConsumerService);
    sqsAdapter = module.get(SqsAdapter);
    prismaService = module.get(PrismaService);
  });

  afterEach(async () => {
    // Ensure service is stopped to prevent test pollution
    if (service.running) {
      await service.onModuleDestroy();
    }
    jest.clearAllMocks();
  });

  describe('Module Lifecycle', () => {
    it('should set isRunning to true on module init (S-2)', async () => {
      // onModuleInit starts the polling loop
      await service.onModuleInit();

      expect(service.running).toBe(true);
    });

    it('should set isRunning to false on module destroy (S-3)', async () => {
      await service.onModuleInit();
      expect(service.running).toBe(true);

      await service.onModuleDestroy();
      expect(service.running).toBe(false);
    });
  });

  describe('processDlqMessages', () => {
    it('should receive messages from DLQ with correct parameters', async () => {
      await service.processDlqMessages();

      expect(sqsAdapter.receiveMessages).toHaveBeenCalledWith(
        10, // waitTimeSeconds
        10, // maxNumberOfMessages
        mockDlqUrl, // DLQ URL
      );
    });

    it('should handle empty message list gracefully', async () => {
      sqsAdapter.receiveMessages.mockResolvedValue([]);

      await expect(service.processDlqMessages()).resolves.not.toThrow();

      expect(prismaService.transaction.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('E-5: retryOnFailure handling', () => {
    it('should mark transaction as failed when retryOnFailure=false', async () => {
      const message = createMockMessage(mockTransactionId, false);
      sqsAdapter.receiveMessages.mockResolvedValue([message]);
      (prismaService.transaction.findUnique as jest.Mock).mockResolvedValue({
        id: mockTransactionId,
        status: 'processing',
      });
      (prismaService.transaction.update as jest.Mock).mockResolvedValue({});

      await service.processDlqMessages();

      expect(prismaService.transaction.update).toHaveBeenCalledWith({
        where: { id: mockTransactionId },
        data: {
          status: 'failed',
          error_message: 'DLQ: Max retries exceeded',
        },
      });
    });

    it('should mark transaction as failed when retryOnFailure=undefined (U-3 backward compatibility)', async () => {
      const message = createMockMessage(mockTransactionId, undefined);
      sqsAdapter.receiveMessages.mockResolvedValue([message]);
      (prismaService.transaction.findUnique as jest.Mock).mockResolvedValue({
        id: mockTransactionId,
        status: 'processing',
      });
      (prismaService.transaction.update as jest.Mock).mockResolvedValue({});

      await service.processDlqMessages();

      expect(prismaService.transaction.update).toHaveBeenCalledWith({
        where: { id: mockTransactionId },
        data: {
          status: 'failed',
          error_message: 'DLQ: Max retries exceeded',
        },
      });
    });

    it('should mark transaction as failed when retryOnFailure=true (O-2: future reprocessing)', async () => {
      const message = createMockMessage(mockTransactionId, true);
      sqsAdapter.receiveMessages.mockResolvedValue([message]);
      (prismaService.transaction.findUnique as jest.Mock).mockResolvedValue({
        id: mockTransactionId,
        status: 'processing',
      });
      (prismaService.transaction.update as jest.Mock).mockResolvedValue({});

      await service.processDlqMessages();

      // O-2: Currently treated same as failure
      expect(prismaService.transaction.update).toHaveBeenCalledWith({
        where: { id: mockTransactionId },
        data: {
          status: 'failed',
          error_message: 'DLQ: Max retries exceeded (retryOnFailure=true, reprocessing not yet implemented)',
        },
      });
    });
  });

  describe('E-6: Idempotency', () => {
    it('should skip processing and delete message if transaction already failed', async () => {
      const message = createMockMessage(mockTransactionId, false);
      sqsAdapter.receiveMessages.mockResolvedValue([message]);
      (prismaService.transaction.findUnique as jest.Mock).mockResolvedValue({
        id: mockTransactionId,
        status: 'failed',
      });

      await service.processDlqMessages();

      // Should NOT update transaction (already in terminal state)
      expect(prismaService.transaction.update).not.toHaveBeenCalled();
      // Should still delete the message
      expect(sqsAdapter.deleteMessage).toHaveBeenCalledWith(
        'receipt-1',
        mockDlqUrl,
      );
    });

    it('should skip processing and delete message if transaction already confirmed', async () => {
      const message = createMockMessage(mockTransactionId, false);
      sqsAdapter.receiveMessages.mockResolvedValue([message]);
      (prismaService.transaction.findUnique as jest.Mock).mockResolvedValue({
        id: mockTransactionId,
        status: 'confirmed',
      });

      await service.processDlqMessages();

      expect(prismaService.transaction.update).not.toHaveBeenCalled();
      expect(sqsAdapter.deleteMessage).toHaveBeenCalledWith(
        'receipt-1',
        mockDlqUrl,
      );
    });
  });

  describe('U-2: Message deletion', () => {
    it('should always delete DLQ message after successful processing', async () => {
      const message = createMockMessage(mockTransactionId, false);
      sqsAdapter.receiveMessages.mockResolvedValue([message]);
      (prismaService.transaction.findUnique as jest.Mock).mockResolvedValue({
        id: mockTransactionId,
        status: 'processing',
      });
      (prismaService.transaction.update as jest.Mock).mockResolvedValue({});

      await service.processDlqMessages();

      expect(sqsAdapter.deleteMessage).toHaveBeenCalledWith(
        'receipt-1',
        mockDlqUrl,
      );
    });

    it('should delete DLQ message even if transaction update fails', async () => {
      const message = createMockMessage(mockTransactionId, false);
      sqsAdapter.receiveMessages.mockResolvedValue([message]);
      (prismaService.transaction.findUnique as jest.Mock).mockResolvedValue({
        id: mockTransactionId,
        status: 'processing',
      });
      (prismaService.transaction.update as jest.Mock).mockRejectedValueOnce(
        new Error('DB error'),
      );
      (prismaService.transaction.update as jest.Mock).mockResolvedValueOnce({});

      await service.processDlqMessages();

      // Should still attempt to delete the message
      expect(sqsAdapter.deleteMessage).toHaveBeenCalled();
    });
  });

  describe('U-5: Transaction status check', () => {
    it('should check transaction status before processing', async () => {
      const message = createMockMessage(mockTransactionId, false);
      sqsAdapter.receiveMessages.mockResolvedValue([message]);
      (prismaService.transaction.findUnique as jest.Mock).mockResolvedValue({
        id: mockTransactionId,
        status: 'processing',
      });
      (prismaService.transaction.update as jest.Mock).mockResolvedValue({});

      await service.processDlqMessages();

      expect(prismaService.transaction.findUnique).toHaveBeenCalledWith({
        where: { id: mockTransactionId },
      });
    });
  });

  describe('Error handling', () => {
    it('should handle malformed message body gracefully', async () => {
      const malformedMessage = {
        MessageId: 'msg-bad',
        Body: 'not-json',
        ReceiptHandle: 'receipt-bad',
      };
      sqsAdapter.receiveMessages.mockResolvedValue([malformedMessage]);

      // Should not throw
      await expect(service.processDlqMessages()).resolves.not.toThrow();
    });

    it('should continue processing other messages if one fails', async () => {
      const message1 = {
        MessageId: 'msg-1',
        Body: JSON.stringify({
          transactionId: 'tx-1',
          type: 'direct',
          request: { to: '0x123', data: '0x' },
          retryOnFailure: false,
        }),
        ReceiptHandle: 'receipt-1',
      };
      const message2 = {
        MessageId: 'msg-2',
        Body: JSON.stringify({
          transactionId: 'tx-2',
          type: 'direct',
          request: { to: '0x123', data: '0x' },
          retryOnFailure: false,
        }),
        ReceiptHandle: 'receipt-2',
      };

      sqsAdapter.receiveMessages.mockResolvedValue([message1, message2]);
      (prismaService.transaction.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'tx-1', status: 'processing' })
        .mockResolvedValueOnce({ id: 'tx-2', status: 'processing' });
      (prismaService.transaction.update as jest.Mock)
        .mockRejectedValueOnce(new Error('DB error for tx-1'))
        .mockResolvedValueOnce({}) // Recovery update for tx-1
        .mockResolvedValueOnce({}); // Normal update for tx-2

      await service.processDlqMessages();

      // Both messages should be processed
      expect(prismaService.transaction.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('Polling Configuration', () => {
    it('should poll DLQ with configured URL', async () => {
      await service.processDlqMessages();

      // Verify DLQ URL is used
      expect(sqsAdapter.receiveMessages).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        mockDlqUrl,
      );
    });

    it('should use configured wait time and max messages', async () => {
      await service.processDlqMessages();

      // Verify configured values are used (10, 10)
      expect(sqsAdapter.receiveMessages).toHaveBeenCalledWith(
        10,
        10,
        expect.any(String),
      );
    });
  });
});
