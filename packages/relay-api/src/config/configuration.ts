export default () => ({
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  apiKey: process.env.RELAY_API_KEY,
  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },
  rpc: {
    url: process.env.RPC_URL || "http://localhost:8545",
  },
});
