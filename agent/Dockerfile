# ---- Build stage ----
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Download dependencies first (layer cache)
COPY go.mod go.sum ./
RUN go mod download

# Build Linux amd64 binary
COPY . .
ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64
RUN go build -ldflags="-s -w" -o obliance-agent .

# ---- Production stage ----
FROM alpine:latest

# ca-certificates for HTTPS checks (HTTP monitor, SSL checks)
RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=builder /app/obliance-agent .

ENTRYPOINT ["/app/obliance-agent"]
