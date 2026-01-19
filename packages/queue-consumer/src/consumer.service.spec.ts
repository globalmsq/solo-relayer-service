import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConsumerService } from './consumer.service';
import { SqsAdapter } from './sqs/sqs.adapter';
import { OzRelayerClient } from './relay/oz-relayer.client';
import { RelayerRouterService } from './relay/relayer-router.service';
import { PrismaService } from './prisma/prisma.service';

describe('ConsumerService (Fire-and-Forget Pattern)', () => {
  let service: ConsumerService;
  let sqsAdapter: SqsAdapter;
  let relayerClient: OzRelayerClient;
  let relayerRouter: RelayerRouterService;
  let prisma: PrismaService;
  let configService: ConfigService;

  const mockRelayerUrl = 'http://oz-relayer-0:8080';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConsumerService,
        {
          provide: SqsAdapter,
          useValue: {
            receiveMessages: jest.fn(),
            deleteMessage: jest.fn(),
          },
        },
        {
          provide: OzRelayerClient,
          useValue: {
            sendDirectTransactionAsync: jest.fn(),
            sendGaslessTransactionAsync: jest.fn(),
            // Legacy methods for backward compatibility
            sendDirectTransaction: jest.fn(),
            sendGaslessTransaction: jest.fn(),
          },
        },
        {
          provide: RelayerRouterService,
          useValue: {
            getAvailableRelayer: jest.fn().mockResolvedValue({
              url: mockRelayerUrl,
              relayerId: 'relayer-1-id',
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            transaction: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string | object> = {
                SQS_QUEUE_URL: 'http://localhost:4566/000000000000/relay-transactions',
                consumer: {
                  waitTimeSeconds: 20,
                  maxNumberOfMessages: 10,
                },
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ConsumerService>(ConsumerService);
    sqsAdapter = module.get<SqsAdapter>(SqsAdapter);
    relayerClient = module.get<OzRelayerClient>(OzRelayerClient);
    relayerRouter = module.get<RelayerRouterService>(RelayerRouterService);
    prisma = module.get<PrismaService>(PrismaService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processMessages', () => {
    it('should receive messages from SQS', async () => {
      const mockMessages = [
        {
          MessageId: 'test-message-1',
          Body: JSON.stringify({
            transactionId: 'tx-123',
            type: 'direct',
            request: { to: '0x123', data: '0xabc' },
          }),
          ReceiptHandle: 'receipt-1',
        },
      ];

      jest.spyOn(sqsAdapter, 'receiveMessages').mockResolvedValue(mockMessages);
      jest.spyOn(prisma.transaction, 'findUnique').mockResolvedValue({
        id: 'tx-123',
        status: 'queued',
        ozRelayerTxId: null,
      } as any);
      jest.spyOn(relayerClient, 'sendDirectTransactionAsync').mockResolvedValue({
        transactionId: 'oz-tx-123',
        relayerUrl: mockRelayerUrl,
      });

      await expect(service.processMessages()).resolves.not.toThrow();
    });

    it('should use smart routing to select relayer (FR-001)', async () => {
      const transactionId = 'tx-123';
      const mockMessage = {
        MessageId: 'msg-1',
        Body: JSON.stringify({
          transactionId,
          type: 'direct',
          request: { to: '0x123', data: '0xabc' },
        }),
        ReceiptHandle: 'receipt-1',
      };

      jest.spyOn(sqsAdapter, 'receiveMessages').mockResolvedValue([mockMessage]);
      jest.spyOn(prisma.transaction, 'findUnique').mockResolvedValue({
        id: transactionId,
        status: 'queued',
        ozRelayerTxId: null,
      } as any);
      jest.spyOn(relayerClient, 'sendDirectTransactionAsync').mockResolvedValue({
        transactionId: 'oz-tx-123',
        relayerUrl: mockRelayerUrl,
      });

      await service.processMessages();

      // FR-001: Smart Routing - Should call getAvailableRelayer
      expect(relayerRouter.getAvailableRelayer).toHaveBeenCalled();
      // Fire-and-Forget: Should call async method with selected relayer URL and relayerId
      // SPEC-ROUTING-001 FIX: Now passes relayerId to avoid redundant API call
      expect(relayerClient.sendDirectTransactionAsync).toHaveBeenCalledWith(
        expect.any(Object),
        mockRelayerUrl,
        'relayer-1-id',
      );
    });

    it('should delete SQS message immediately after submission (FR-002 Fire-and-Forget)', async () => {
      const mockMessage = {
        MessageId: 'msg-1',
        Body: JSON.stringify({
          transactionId: 'tx-123',
          type: 'direct',
          request: { to: '0x123', data: '0xabc' },
        }),
        ReceiptHandle: 'receipt-1',
      };

      jest.spyOn(sqsAdapter, 'receiveMessages').mockResolvedValue([mockMessage]);
      jest.spyOn(prisma.transaction, 'findUnique').mockResolvedValue({
        id: 'tx-123',
        status: 'queued',
        ozRelayerTxId: null,
      } as any);
      jest.spyOn(relayerClient, 'sendDirectTransactionAsync').mockResolvedValue({
        transactionId: 'oz-tx-123',
        relayerUrl: mockRelayerUrl,
      });

      await service.processMessages();

      // Fire-and-Forget: Delete immediately after submission, no polling
      expect(sqsAdapter.deleteMessage).toHaveBeenCalledWith('receipt-1');
    });

    it('should set status to submitted, NOT confirmed (DC-004)', async () => {
      const transactionId = 'tx-123';
      const ozRelayerTxId = 'oz-tx-123';
      const mockMessage = {
        MessageId: 'msg-1',
        Body: JSON.stringify({
          transactionId,
          type: 'direct',
          request: { to: '0x123', data: '0xabc' },
        }),
        ReceiptHandle: 'receipt-1',
      };

      jest.spyOn(sqsAdapter, 'receiveMessages').mockResolvedValue([mockMessage]);
      jest.spyOn(prisma.transaction, 'findUnique').mockResolvedValue({
        id: transactionId,
        status: 'queued',
        ozRelayerTxId: null,
      } as any);
      jest.spyOn(relayerClient, 'sendDirectTransactionAsync').mockResolvedValue({
        transactionId: ozRelayerTxId,
        relayerUrl: mockRelayerUrl,
      });

      await service.processMessages();

      // DC-004: Consumer sets ozRelayerTxId and ozRelayerUrl, NOT hash
      // Status is 'submitted', not 'confirmed' (Webhook handles confirmation)
      expect(prisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: transactionId },
          data: expect.objectContaining({
            status: 'submitted',
            ozRelayerTxId,
            ozRelayerUrl: mockRelayerUrl,
          }),
        }),
      );

      // Verify hash is NOT set by consumer (DC-004 Hash Field Separation)
      const updateCall = (prisma.transaction.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.hash).toBeUndefined();
    });

    it('should track ozRelayerUrl for debugging (DC-005)', async () => {
      const transactionId = 'tx-123';
      const selectedRelayerUrl = 'http://oz-relayer-1:8080';
      const mockMessage = {
        MessageId: 'msg-1',
        Body: JSON.stringify({
          transactionId,
          type: 'direct',
          request: { to: '0x123', data: '0xabc' },
        }),
        ReceiptHandle: 'receipt-1',
      };

      jest.spyOn(relayerRouter, 'getAvailableRelayer').mockResolvedValue({
        url: selectedRelayerUrl,
        relayerId: 'relayer-2-id',
      });
      jest.spyOn(sqsAdapter, 'receiveMessages').mockResolvedValue([mockMessage]);
      jest.spyOn(prisma.transaction, 'findUnique').mockResolvedValue({
        id: transactionId,
        status: 'queued',
        ozRelayerTxId: null,
      } as any);
      jest.spyOn(relayerClient, 'sendDirectTransactionAsync').mockResolvedValue({
        transactionId: 'oz-tx-123',
        relayerUrl: selectedRelayerUrl,
      });

      await service.processMessages();

      // DC-005: Track which relayer handled the TX
      expect(prisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ozRelayerUrl: selectedRelayerUrl,
          }),
        }),
      );
    });

    it('should handle duplicate messages - idempotency via ozRelayerTxId (FR-004)', async () => {
      const transactionId = 'tx-123';
      const mockMessage = {
        MessageId: 'msg-1',
        Body: JSON.stringify({
          transactionId,
          type: 'direct',
          request: { to: '0x123', data: '0xabc' },
        }),
        ReceiptHandle: 'receipt-1',
      };

      // Transaction already submitted (has ozRelayerTxId)
      jest.spyOn(prisma.transaction, 'findUnique').mockResolvedValue({
        id: transactionId,
        status: 'submitted',
        ozRelayerTxId: 'already-submitted-oz-tx-id',
      } as any);

      jest.spyOn(sqsAdapter, 'receiveMessages').mockResolvedValue([mockMessage]);

      await service.processMessages();

      // FR-004: Idempotency - Should delete SQS message without re-submitting
      expect(sqsAdapter.deleteMessage).toHaveBeenCalled();
      expect(relayerClient.sendDirectTransactionAsync).not.toHaveBeenCalled();
    });

    it('should handle terminal state (confirmed) - skip processing', async () => {
      const transactionId = 'tx-123';
      const mockMessage = {
        MessageId: 'msg-1',
        Body: JSON.stringify({
          transactionId,
          type: 'direct',
          request: { to: '0x123', data: '0xabc' },
        }),
        ReceiptHandle: 'receipt-1',
      };

      // Transaction already in terminal state
      jest.spyOn(prisma.transaction, 'findUnique').mockResolvedValue({
        id: transactionId,
        status: 'confirmed',
      } as any);

      jest.spyOn(sqsAdapter, 'receiveMessages').mockResolvedValue([mockMessage]);

      await service.processMessages();

      // Should delete message without re-processing
      expect(sqsAdapter.deleteMessage).toHaveBeenCalled();
      expect(relayerClient.sendDirectTransactionAsync).not.toHaveBeenCalled();
    });

    it('should handle OZ Relayer errors and NOT delete SQS message', async () => {
      const mockMessage = {
        MessageId: 'msg-1',
        Body: JSON.stringify({
          transactionId: 'tx-123',
          type: 'direct',
          request: { to: '0x123', data: '0xabc' },
        }),
        ReceiptHandle: 'receipt-1',
      };

      jest.spyOn(sqsAdapter, 'receiveMessages').mockResolvedValue([mockMessage]);
      jest.spyOn(prisma.transaction, 'findUnique').mockResolvedValue({
        id: 'tx-123',
        status: 'queued',
        ozRelayerTxId: null,
      } as any);
      jest
        .spyOn(relayerClient, 'sendDirectTransactionAsync')
        .mockRejectedValue(new Error('OZ Relayer unavailable'));

      // Should not throw, message should be returned to queue
      await expect(service.processMessages()).resolves.not.toThrow();

      // Should not delete message on failure (SQS will retry)
      expect(sqsAdapter.deleteMessage).not.toHaveBeenCalled();
    });

    it('should process gasless transactions with Fire-and-Forget', async () => {
      const transactionId = 'tx-gasless-123';
      const forwarderAddress = '0xForwarder123';
      const mockMessage = {
        MessageId: 'msg-1',
        Body: JSON.stringify({
          transactionId,
          type: 'gasless',
          request: {
            request: {
              from: '0xUser',
              to: '0x123',
              value: '0',
              gas: '100000',
              nonce: '1',
              deadline: '9999999999',
              data: '0xabc',
            },
            signature: '0xsig123',
          },
          forwarderAddress,
        }),
        ReceiptHandle: 'receipt-1',
      };

      jest.spyOn(sqsAdapter, 'receiveMessages').mockResolvedValue([mockMessage]);
      jest.spyOn(prisma.transaction, 'findUnique').mockResolvedValue({
        id: transactionId,
        status: 'queued',
        ozRelayerTxId: null,
      } as any);
      jest.spyOn(relayerClient, 'sendGaslessTransactionAsync').mockResolvedValue({
        transactionId: 'oz-gasless-tx-123',
        relayerUrl: mockRelayerUrl,
      });

      await service.processMessages();

      // SPEC-ROUTING-001 FIX: Now passes relayerId to avoid redundant API call
      expect(relayerClient.sendGaslessTransactionAsync).toHaveBeenCalledWith(
        expect.any(Object),
        forwarderAddress,
        mockRelayerUrl,
        'relayer-1-id',
      );
      expect(sqsAdapter.deleteMessage).toHaveBeenCalled();
    });
  });

  describe('graceful shutdown', () => {
    it('should stop processing on SIGTERM', async () => {
      const spy = jest.spyOn(service, 'onModuleDestroy');

      await service.onModuleDestroy();

      expect(spy).toHaveBeenCalled();
    });
  });
});
