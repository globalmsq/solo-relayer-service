FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate
WORKDIR /app

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy package.json files for all packages (needed for workspace resolution)
COPY packages/relay-api/package.json ./packages/relay-api/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/integration-tests/package.json ./packages/integration-tests/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/relay-api ./packages/relay-api
COPY packages/integration-tests ./packages/integration-tests

WORKDIR /app/packages/integration-tests

# Default command: run tests
CMD ["pnpm", "test"]
