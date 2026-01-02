import { randomUUID } from "crypto";

export const createMockOzRelayerResponse = (overrides?: Partial<any>) => ({
  transactionId: randomUUID(),
  hash: null,
  status: "pending",
  createdAt: new Date().toISOString(),
  ...overrides,
});

export const createMockConfirmedResponse = (overrides?: Partial<any>) => ({
  transactionId: randomUUID(),
  hash: "0x" + "1".repeat(64),
  status: "confirmed",
  createdAt: new Date().toISOString(),
  confirmedAt: new Date().toISOString(),
  ...overrides,
});

export const createMockFailedResponse = (overrides?: Partial<any>) => ({
  transactionId: randomUUID(),
  hash: null,
  status: "failed",
  createdAt: new Date().toISOString(),
  failedAt: new Date().toISOString(),
  error: "Transaction reverted",
  ...overrides,
});
