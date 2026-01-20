// SPEC-DISCOVERY-001: oz_relayer config removed - transactions processed via queue-consumer
export const TEST_CONFIG = {
  forwarder: {
    address: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9", // Hardhat default Forwarder
    chain_id: 31337, // Hardhat local network
    name: "ERC2771Forwarder", // EIP-712 domain name - must match contract deployment
  },
  api: {
    key: "test-api-key",
  },
  webhook: {
    signing_key: "test-webhook-signing-key-32-chars",
    client_url: "http://localhost:8080/webhooks/transaction-updates", // Changed for E2E tests
  },
};
