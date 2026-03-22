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

# ---- Production stage ----
# Agent binaries are pre-built by 000-RegularUpdate.bat:
#   Windows: local build → agent/dist/obliance-agent.exe + .msi
#   macOS:   SSH to 192.168.1.5 → agent/dist/obliance-agent-darwin-*
#   Linux:   SSH to 10.0.0.152 → agent/dist/obliance-agent-linux-*
# No Go compilation needed in Docker — just COPY from agent/dist/.
FROM node:24-alpine AS production
WORKDIR /app

RUN apk add --no-cache openssh-client

COPY --from=builder /app/shared/package.json ./shared/
COPY --from=builder /app/shared/dist/ ./shared/dist/

COPY --from=builder /app/server/package.json ./server/
COPY package.json ./
RUN cd server && npm install --omit=dev

COPY --from=builder /app/server/dist/ ./server/dist/

# Client package.json — version used by GET /api/system
COPY client/package.json ./client/

# Agent installer scripts + VERSION file (used by GET /api/agent/version)
COPY agent/installer/ ./agent/installer/
COPY agent/VERSION ./agent/

# Pre-built agent binaries (Windows .exe/.msi, Linux, macOS) from agent/dist/
# Built by 000-RegularUpdate.bat before docker build — no Go stage needed.
RUN mkdir -p ./agent/dist
COPY agent/dist/ ./agent/dist/

# Obli.tools VERSION file — obli.tools/ is a symlink to an external directory and cannot be
# followed by the Docker build context. The version is injected via --build-arg at build time;
# defaults to "0.0.0" so the build never fails when the arg is omitted.
ARG OBLITOOLS_VERSION=0.0.0
RUN mkdir -p ./obli.tools && printf '%s' "${OBLITOOLS_VERSION}" > ./obli.tools/VERSION

# Obli.tools release binaries (build on Windows: obli.tools/build-windows.ps1 → dist/ObliTools.exe)
#                              (build on macOS:   obli.tools/build-mac.sh      → dist/ObliTools-*.dmg/zip)
# obli.tools/ is a junction — Docker cannot follow it. The bat file stages the files into
# _oblitools_dist_stage/ (a real directory) before building so COPY works.
# If no binaries were built yet only a .keep placeholder is present → /downloads returns 404.
RUN mkdir -p ./obli.tools/dist
COPY _oblitools_dist_stage/ ./obli.tools/dist/

COPY server/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

WORKDIR /app/server
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/src/index.js"]
