/**
 * SPEC-GASLESS-001 E2E Test Script
 * Tests gasless transaction API with EIP-712 signature
 *
 * Usage: npx ts-node scripts/test-gasless.ts
 */

import { Wallet, TypedDataDomain, TypedDataField, Interface } from "ethers";

// Configuration
const API_URL = "http://localhost:3000";
const API_KEY = "local-dev-api-key";
const CHAIN_ID = 31337;
const FORWARDER_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const FORWARDER_NAME = "MSQForwarder";

// Hardhat Account #1 (test user)
const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const TEST_USER_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

// Target contract (using Forwarder itself for simple test)
const TARGET_ADDRESS = FORWARDER_ADDRESS;

// EIP-712 Domain and Types
const domain: TypedDataDomain = {
  name: FORWARDER_NAME,
  version: "1",
  chainId: CHAIN_ID,
  verifyingContract: FORWARDER_ADDRESS,
};

const types: Record<string, TypedDataField[]> = {
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

async function getNonce(address: string): Promise<string> {
  const response = await fetch(
    `${API_URL}/api/v1/relay/gasless/nonce/${address}`,
    {
      headers: { "X-API-Key": API_KEY },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to get nonce: ${response.status}`);
  }

  const data = await response.json();
  return data.nonce;
}

async function submitGaslessTransaction(
  request: any,
  signature: string,
): Promise<any> {
  const response = await fetch(`${API_URL}/api/v1/relay/gasless`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
    },
    body: JSON.stringify({ request, signature }),
  });

  const data = await response.json();
  return { status: response.status, data };
}

async function runTests() {
  console.log("🤖 SPEC-GASLESS-001 E2E Test");
  console.log("═".repeat(60));

  const wallet = new Wallet(TEST_PRIVATE_KEY);
  console.log(`\n📍 Test User: ${wallet.address}`);

  // Test 1: Nonce Query
  console.log("\n─────────────────────────────────────────────────────────────");
  console.log("📋 Test 1: Nonce Query API");
  console.log("─────────────────────────────────────────────────────────────");

  const nonce = await getNonce(wallet.address);
  console.log(`✅ Current nonce: ${nonce}`);

  // Test 2: Valid Gasless Transaction
  console.log("\n─────────────────────────────────────────────────────────────");
  console.log("📋 Test 2: Submit Valid Gasless Transaction");
  console.log("─────────────────────────────────────────────────────────────");

  const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

  // Simple call data (empty for basic test)
  const callData = "0x";

  const forwardRequest = {
    from: wallet.address,
    to: TARGET_ADDRESS,
    value: "0",
    gas: "100000",
    nonce: nonce,
    deadline: deadline,
    data: callData,
  };

  console.log("📝 ForwardRequest:", JSON.stringify(forwardRequest, null, 2));

  // Sign EIP-712 message
  const signature = await wallet.signTypedData(domain, types, forwardRequest);
  console.log(`🔏 Signature: ${signature.substring(0, 20)}...`);

  const result = await submitGaslessTransaction(forwardRequest, signature);

  if (result.status === 202) {
    console.log("✅ Transaction accepted!");
    console.log(`   TransactionId: ${result.data.transactionId}`);
    console.log(`   Status: ${result.data.status}`);
    console.log(`   Hash: ${result.data.hash || "pending"}`);
  } else {
    console.log(`❌ Transaction failed: ${result.status}`);
    console.log(`   Error: ${JSON.stringify(result.data)}`);
  }

  // Test 3: Invalid Signature
  console.log("\n─────────────────────────────────────────────────────────────");
  console.log("📋 Test 3: Invalid Signature Detection");
  console.log("─────────────────────────────────────────────────────────────");

  const invalidSignature = "0x" + "00".repeat(65);
  const invalidResult = await submitGaslessTransaction(
    forwardRequest,
    invalidSignature,
  );

  if (invalidResult.status === 400 || invalidResult.status === 401) {
    console.log(`✅ Invalid signature rejected: ${invalidResult.status}`);
    console.log(`   Message: ${invalidResult.data.message}`);
  } else {
    console.log(`❌ Expected rejection but got: ${invalidResult.status}`);
  }

  // Test 4: Expired Deadline
  console.log("\n─────────────────────────────────────────────────────────────");
  console.log("📋 Test 4: Expired Deadline Detection");
  console.log("─────────────────────────────────────────────────────────────");

  const expiredRequest = {
    ...forwardRequest,
    deadline: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
  };

  const expiredSignature = await wallet.signTypedData(
    domain,
    types,
    expiredRequest,
  );
  const expiredResult = await submitGaslessTransaction(
    expiredRequest,
    expiredSignature,
  );

  if (expiredResult.status === 400) {
    console.log("✅ Expired deadline rejected");
    console.log(`   Message: ${expiredResult.data.message}`);
  } else {
    console.log(`❌ Expected 400 but got: ${expiredResult.status}`);
  }

  // Test 5: Invalid Ethereum Address
  console.log("\n─────────────────────────────────────────────────────────────");
  console.log("📋 Test 5: Invalid Address Format");
  console.log("─────────────────────────────────────────────────────────────");

  try {
    const invalidResponse = await fetch(
      `${API_URL}/api/v1/relay/gasless/nonce/invalid-address`,
      {
        headers: { "X-API-Key": API_KEY },
      },
    );

    if (invalidResponse.status === 400) {
      const errorData = await invalidResponse.json();
      console.log("✅ Invalid address rejected");
      console.log(`   Message: ${errorData.message}`);
    } else {
      console.log(`❌ Expected 400 but got: ${invalidResponse.status}`);
    }
  } catch (e) {
    console.log(`❌ Error: ${e}`);
  }

  // Summary
  console.log("\n═".repeat(60));
  console.log("📊 Test Summary");
  console.log("═".repeat(60));
  console.log("✅ Nonce Query API: PASS");
  console.log(
    result.status === 202
      ? "✅ Gasless Transaction: PASS"
      : "❌ Gasless Transaction: FAIL",
  );
  console.log(
    invalidResult.status === 400 || invalidResult.status === 401
      ? "✅ Invalid Signature Detection: PASS"
      : "❌ Invalid Signature Detection: FAIL",
  );
  console.log(
    expiredResult.status === 400
      ? "✅ Expired Deadline Detection: PASS"
      : "❌ Expired Deadline Detection: FAIL",
  );
}

runTests().catch(console.error);
