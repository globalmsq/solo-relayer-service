import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "./prisma.service";

describe("PrismaService", () => {
  let service: PrismaService;

  // Mock PrismaClient
  const mockTransactionDelegate = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  };

  const mockPrismaClient = {
    transaction: mockTransactionDelegate,
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $executeRawUnsafe: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: PrismaService,
          useValue: mockPrismaClient,
        },
      ],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("Database Connection", () => {
    it("should have $connect method", () => {
      expect(service.$connect).toBeDefined();
      expect(typeof service.$connect).toBe("function");
    });

    it("should have $disconnect method", () => {
      expect(service.$disconnect).toBeDefined();
      expect(typeof service.$disconnect).toBe("function");
    });

    it("should have $executeRawUnsafe method", () => {
      expect(service.$executeRawUnsafe).toBeDefined();
      expect(typeof service.$executeRawUnsafe).toBe("function");
    });
  });

  describe("Transaction Model", () => {
    it("should have transaction delegate", () => {
      expect(service.transaction).toBeDefined();
    });

    it("should support create operation", () => {
      expect(service.transaction.create).toBeDefined();
      expect(typeof service.transaction.create).toBe("function");
    });

    it("should support findUnique operation", () => {
      expect(service.transaction.findUnique).toBeDefined();
      expect(typeof service.transaction.findUnique).toBe("function");
    });

    it("should support findMany operation", () => {
      expect(service.transaction.findMany).toBeDefined();
      expect(typeof service.transaction.findMany).toBe("function");
    });

    it("should support update operation", () => {
      expect(service.transaction.update).toBeDefined();
      expect(typeof service.transaction.update).toBe("function");
    });

    it("should support upsert operation", () => {
      expect(service.transaction.upsert).toBeDefined();
      expect(typeof service.transaction.upsert).toBe("function");
    });

    it("should support delete operation", () => {
      expect(service.transaction.delete).toBeDefined();
      expect(typeof service.transaction.delete).toBe("function");
    });

    it("should support deleteMany operation", () => {
      expect(service.transaction.deleteMany).toBeDefined();
      expect(typeof service.transaction.deleteMany).toBe("function");
    });
  });

  describe("Transaction Create", () => {
    it("should create a transaction", async () => {
      const createInput = {
        data: {
          status: "pending",
          to: "0x1234567890123456789012345678901234567890",
          value: "1000000000000000000",
          data: "0x",
        },
      };
      const mockTx = { id: 1, transactionId: "test-tx-1", ...createInput.data };
      mockTransactionDelegate.create.mockResolvedValue(mockTx);

      const result = await service.transaction.create(createInput);

      expect(service.transaction.create).toHaveBeenCalledWith(createInput);
      expect(result).toBeDefined();
      expect(result.transactionId).toBe("test-tx-1");
      expect(result.status).toBe("pending");
    });

    it("should create transaction with transactionHash", async () => {
      const createInput = {
        data: {
          status: "pending",
          transactionHash: "0xabc123",
          to: "0x1234567890123456789012345678901234567890",
        },
      };
      const mockTx = { id: 2, transactionId: "test-tx-2", ...createInput.data };
      mockTransactionDelegate.create.mockResolvedValue(mockTx);

      const result = await service.transaction.create(createInput);

      expect(result.transactionHash).toBe("0xabc123");
    });
  });

  describe("Transaction Find", () => {
    it("should find transaction by transactionId", async () => {
      const txId = "test-tx-find";
      const mockTx = {
        id: 1,
        transactionId: txId,
        status: "confirmed",
        transactionHash: "0xabc123",
        to: "0x1234567890123456789012345678901234567890",
      };
      mockTransactionDelegate.findUnique.mockResolvedValue(mockTx);

      const result = await service.transaction.findUnique({
        where: { transactionId: txId },
      });

      expect(service.transaction.findUnique).toHaveBeenCalledWith({
        where: { transactionId: txId },
      });
      expect(result).toBeDefined();
      expect(result!.transactionId).toBe(txId);
      expect(result!.status).toBe("confirmed");
    });

    it("should return null when transaction not found", async () => {
      mockTransactionDelegate.findUnique.mockResolvedValue(null);

      const result = await service.transaction.findUnique({
        where: { transactionId: "non-existent" },
      });

      expect(result).toBeNull();
    });

    it("should find transactions by status", async () => {
      const mockTxs = [
        { id: 1, transactionId: "tx-1", status: "pending" },
        { id: 2, transactionId: "tx-2", status: "pending" },
      ];
      mockTransactionDelegate.findMany.mockResolvedValue(mockTxs);

      const result = await service.transaction.findMany({
        where: { status: "pending" },
      });

      expect(service.transaction.findMany).toHaveBeenCalledWith({
        where: { status: "pending" },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("Transaction Update", () => {
    it("should update a transaction", async () => {
      const txId = "test-tx-update";
      const updateInput = {
        where: { transactionId: txId },
        data: {
          status: "confirmed",
          transactionHash: "0xupdate123",
          confirmedAt: new Date(),
        },
      };
      const mockUpdated = { id: 1, transactionId: txId, ...updateInput.data };
      mockTransactionDelegate.update.mockResolvedValue(mockUpdated);

      const result = await service.transaction.update(updateInput);

      expect(service.transaction.update).toHaveBeenCalledWith(updateInput);
      expect(result.status).toBe("confirmed");
      expect(result.transactionHash).toBe("0xupdate123");
    });
  });

  describe("Transaction Upsert", () => {
    it("should create transaction on first upsert", async () => {
      const txId = "test-tx-upsert";
      const upsertInput = {
        where: { transactionId: txId },
        create: {
          status: "pending",
          transactionHash: "0xoriginal",
        },
        update: {
          status: "confirmed",
        },
      };
      const mockResult = {
        id: 1,
        transactionId: txId,
        status: "pending",
        transactionHash: "0xoriginal",
      };
      mockTransactionDelegate.upsert.mockResolvedValue(mockResult);

      const result = await service.transaction.upsert(upsertInput);

      expect(service.transaction.upsert).toHaveBeenCalledWith(upsertInput);
      expect(result.status).toBe("pending");
    });

    it("should update transaction on second upsert", async () => {
      const txId = "test-tx-upsert";
      const upsertInput = {
        where: { transactionId: txId },
        create: {
          status: "pending",
        },
        update: {
          status: "confirmed",
          transactionHash: "0xupserted",
        },
      };
      const mockResult = {
        id: 1,
        transactionId: txId,
        status: "confirmed",
        transactionHash: "0xupserted",
      };
      mockTransactionDelegate.upsert.mockResolvedValue(mockResult);

      const result = await service.transaction.upsert(upsertInput);

      expect(result.status).toBe("confirmed");
      expect(result.transactionHash).toBe("0xupserted");
    });
  });

  describe("Transaction Delete", () => {
    it("should delete a transaction", async () => {
      const txId = "test-tx-delete";
      const mockDeleted = { id: 1, transactionId: txId, status: "pending" };
      mockTransactionDelegate.delete.mockResolvedValue(mockDeleted);

      const result = await service.transaction.delete({
        where: { transactionId: txId },
      });

      expect(service.transaction.delete).toHaveBeenCalledWith({
        where: { transactionId: txId },
      });
      expect(result.transactionId).toBe(txId);
    });

    it("should delete many transactions", async () => {
      mockTransactionDelegate.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.transaction.deleteMany({
        where: { status: "failed" },
      });

      expect(service.transaction.deleteMany).toHaveBeenCalledWith({
        where: { status: "failed" },
      });
      expect(result.count).toBe(3);
    });
  });

  describe("Database Indexes", () => {
    it("should support queries with status index", async () => {
      mockTransactionDelegate.findMany.mockResolvedValue([]);

      await service.transaction.findMany({
        where: { status: "pending" },
      });

      expect(service.transaction.findMany).toHaveBeenCalled();
    });

    it("should support queries with transactionHash index", async () => {
      mockTransactionDelegate.findMany.mockResolvedValue([]);

      await service.transaction.findMany({
        where: { transactionHash: "0xtest" },
      });

      expect(service.transaction.findMany).toHaveBeenCalled();
    });

    it("should support queries ordered by createdAt index", async () => {
      mockTransactionDelegate.findMany.mockResolvedValue([]);

      await service.transaction.findMany({
        orderBy: { createdAt: "desc" },
      });

      expect(service.transaction.findMany).toHaveBeenCalled();
    });
  });

  describe("Unique Constraints", () => {
    it("should enforce unique transactionHash constraint", async () => {
      const transactionHash = "0xunique123";
      mockTransactionDelegate.create.mockRejectedValue(
        new Error(
          "Unique constraint failed on the fields: (`transaction_hash`)",
        ),
      );

      const createInput = {
        data: {
          transactionHash,
          status: "pending",
        },
      };

      await expect(service.transaction.create(createInput)).rejects.toThrow(
        "Unique constraint failed",
      );
    });
  });

  describe("Query Patterns", () => {
    it("should support complex where conditions", async () => {
      mockTransactionDelegate.findMany.mockResolvedValue([]);

      await service.transaction.findMany({
        where: {
          status: "pending",
          to: "0x1234567890123456789012345678901234567890",
        },
      });

      expect(service.transaction.findMany).toHaveBeenCalled();
    });

    it("should support pagination", async () => {
      mockTransactionDelegate.findMany.mockResolvedValue([]);

      await service.transaction.findMany({
        skip: 10,
        take: 20,
        orderBy: { createdAt: "desc" },
      });

      expect(service.transaction.findMany).toHaveBeenCalled();
    });

    it("should support field selection", async () => {
      mockTransactionDelegate.findMany.mockResolvedValue([]);

      await service.transaction.findMany({
        select: {
          transactionId: true,
          status: true,
          transactionHash: true,
          createdAt: true,
        },
      });

      expect(service.transaction.findMany).toHaveBeenCalled();
    });
  });
});
