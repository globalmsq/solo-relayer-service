# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Enable Corepack for pnpm
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

# Copy root package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy relayer-discovery package
COPY packages/relayer-discovery ./packages/relayer-discovery

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build the package
WORKDIR /app/packages/relayer-discovery
RUN pnpm build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Enable Corepack for pnpm
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/relayer-discovery/package.json ./packages/relayer-discovery/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/packages/relayer-discovery/dist ./packages/relayer-discovery/dist

WORKDIR /app/packages/relayer-discovery

# Health check
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/status', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

EXPOSE 3001

CMD ["node", "dist/main.js"]
