# ---- Node.js build stage (server + shared) ----
FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json ./
COPY shared/ ./shared/
RUN cd shared && npm install && npm run build

COPY server/package.json ./server/
RUN cd server && npm install

COPY server/tsconfig.json server/knexfile.ts ./server/
COPY server/src/ ./server/src/
RUN cd server && npm run build

# ---- Go cross-compilation stage (Windows + Linux agent binaries) ----
FROM golang:1.22-alpine AS go-agent-builder
WORKDIR /build

# Download dependencies first (layer cache)
COPY agent/go.mod agent/go.sum* ./
RUN go mod download 2>/dev/null || true

COPY agent/ ./
RUN go mod tidy

# All platforms — version injected from VERSION file (single source of truth).
# agent/main.go uses `var agentVersion = "dev"` overridden here via -X ldflags.
RUN VERSION=$(cat VERSION) && \
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
        go build -ldflags="-s -w -X main.agentVersion=${VERSION}" -o dist/obliance-agent.exe . && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
        go build -ldflags="-s -w -X main.agentVersion=${VERSION}" -o dist/obliance-agent-linux-amd64 . && \
    CGO_ENABLED=0 GOOS=linux GOARCH=arm64 \
        go build -ldflags="-s -w -X main.agentVersion=${VERSION}" -o dist/obliance-agent-linux-arm64 . && \
    CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 \
        go build -ldflags="-s -w -X main.agentVersion=${VERSION}" -o dist/obliance-agent-darwin-amd64 . && \
    CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 \
        go build -ldflags="-s -w -X main.agentVersion=${VERSION}" -o dist/obliance-agent-darwin-arm64 .

# ---- Production stage ----
FROM node:24-alpine AS production
WORKDIR /app

RUN apk add --no-cache openssh-client

COPY --from=builder /app/shared/package.json ./shared/
COPY --from=builder /app/shared/dist/ ./shared/dist/

COPY --from=builder /app/server/package.json ./server/
COPY package.json ./
RUN cd server && npm install --omit=dev

COPY --from=builder /app/server/dist/ ./server/dist/

# Agent installer scripts + VERSION file (used by GET /api/agent/version)
COPY agent/installer/ ./agent/installer/
COPY agent/VERSION ./agent/

# Agent binaries from Go cross-compilation
RUN mkdir -p ./agent/dist
COPY --from=go-agent-builder /build/dist/obliance-agent.exe            ./agent/dist/
COPY --from=go-agent-builder /build/dist/obliance-agent-linux-amd64   ./agent/dist/
COPY --from=go-agent-builder /build/dist/obliance-agent-linux-arm64   ./agent/dist/
COPY --from=go-agent-builder /build/dist/obliance-agent-darwin-amd64  ./agent/dist/
COPY --from=go-agent-builder /build/dist/obliance-agent-darwin-arm64  ./agent/dist/

# Pre-built Windows MSI (build on Windows: cd agent && build-msi.bat)
# If absent, the /api/agent/installer/windows.msi endpoint returns 404.
COPY agent/dist/ ./agent/dist/

# Obli.tools VERSION file — obli.tools/ is a symlink to an external directory and cannot be
# followed by the Docker build context. The version is injected via --build-arg at build time;
# defaults to "0.0.0" so the build never fails when the arg is omitted.
ARG OBLITOOLS_VERSION=0.0.0
RUN mkdir -p ./obli.tools && printf '%s' "${OBLITOOLS_VERSION}" > ./obli.tools/VERSION

# Obli.tools release binaries (build on Windows: obli.tools/build-windows.ps1 → dist/ObliTools.exe)
#                              (build on macOS:   obli.tools/build-mac.sh      → dist/ObliTools-*.dmg/zip)
# obli.tools/ is a symlink outside the build context; the dist dir is pre-created so the
# /downloads/:filename endpoint returns 404 for absent files (no hard failure).
RUN mkdir -p ./obli.tools/dist

COPY server/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

WORKDIR /app/server
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/src/index.js"]
