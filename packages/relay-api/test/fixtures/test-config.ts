export const TEST_CONFIG = {
  oz_relayer: {
    url: "https://api.defender.openzeppelin.com",
    api_key: "test-oz-api-key",
    relayer_id: "test-relayer-id",
  },
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
    client_url: "http://client-service:8080/webhooks/transaction-updates",
  },
};
