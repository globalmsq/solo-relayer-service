import { Wallet } from "ethers";
import { TEST_CONFIG } from "../fixtures/test-config";

const EIP712_DOMAIN = {
  name: TEST_CONFIG.forwarder.name,
  version: "1",
  chainId: TEST_CONFIG.forwarder.chain_id,
  verifyingContract: TEST_CONFIG.forwarder.address,
};

const FORWARD_REQUEST_TYPE = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
};

export interface ForwardRequest {
  from: string;
  to: string;
  value: string;
  gas: string;
  nonce: string;
  deadline: string;
  data: string;
}

export async function signForwardRequest(
  wallet: Wallet,
  request: ForwardRequest,
): Promise<string> {
  return wallet.signTypedData(EIP712_DOMAIN, FORWARD_REQUEST_TYPE, request);
}

export function createForwardRequest(
  from: string,
  to: string,
  options: Partial<Omit<ForwardRequest, "nonce">> & { nonce?: number } = {},
): ForwardRequest {
  const { nonce = 0, ...restOptions } = options;
  return {
    from,
    to,
    value: "0",
    gas: "100000",
    nonce: String(nonce),
    deadline: String(Math.floor(Date.now() / 1000) + 3600), // 1 hour later (as string for DTO validation)
    data: "0x00",
    ...restOptions,
  };
}

export function createExpiredForwardRequest(
  from: string,
  to: string,
): ForwardRequest {
  return {
    ...createForwardRequest(from, to),
    deadline: String(Math.floor(Date.now() / 1000) - 3600), // 1 hour ago (expired, as string)
  };
}
