# ==============================================================================
# Multi-stage Dockerfile for Teleprompter Telegram Mini App + Backend
# Optimized for Coolify on Hostinger VPS (Node 20 + SQLite + FFmpeg + WebSockets)
# ==============================================================================

# ------------------------------------------------------------------------------
# 1. Builder Stage: Build frontend assets, compile TypeScript, build native modules
# ------------------------------------------------------------------------------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3 native C++ compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests first for maximum Docker layer caching
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

# Install all dependencies (workspaces root + client + server)
RUN npm ci

# Copy application source code and configs
COPY server/ ./server/
COPY client/ ./client/

# Build client (Vite) and server (TypeScript tsc)
RUN npm run build

# Remove development dependencies to keep final layer lean
RUN npm prune --omit=dev

# ------------------------------------------------------------------------------
# 2. Production Runner Stage: Minimal image with runtime FFmpeg & Curl
# ------------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Install runtime dependencies:
# - ffmpeg: required for processing Reels and circular video notes (640x640 Telegram Video Notes)
# - curl: required for Docker and Coolify healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Production environment variables
ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/app/data

# Copy pre-pruned node_modules containing precompiled better-sqlite3 native binary
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Copy server artifacts
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/server/dist ./server/dist

# Copy client built static assets (served by Express in server/src/index.ts)
COPY --from=builder /app/client/package.json ./client/package.json
COPY --from=builder /app/client/dist ./client/dist

# Create persistent storage directory for SQLite database
RUN mkdir -p /app/data

# Persistent storage volume declaration
VOLUME ["/app/data"]

EXPOSE 3001

# Healthcheck endpoint verified by Coolify / Docker
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Launch production server directly for clean signal handling (SIGTERM)
CMD ["node", "server/dist/index.js"]
