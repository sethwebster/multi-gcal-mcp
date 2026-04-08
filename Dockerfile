FROM node:22-slim

# Install bun for workspace resolution
RUN npm install -g bun@latest

WORKDIR /app

# Copy workspace config + lockfile
COPY package.json bun.lock ./

# Copy all package.json files for dependency resolution
COPY packages/core/package.json packages/core/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/web/package.json packages/web/package.json

# Install deps
RUN bun install --frozen-lockfile

# Copy source
COPY packages/core packages/core
COPY packages/mcp packages/mcp
COPY packages/web packages/web

# Persistent data dir — mount a CapRover volume here
RUN mkdir -p /data
ENV TOKENS_DIR=/data

ENV PORT=3000
EXPOSE 3000

CMD ["node", "packages/mcp/src/index.js", "--http"]
