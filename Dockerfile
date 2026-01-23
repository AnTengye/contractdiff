# =============================================================================
# Stage 1: Frontend Build
# =============================================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Install dependencies first (better layer caching)
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --prefer-offline --no-audit || npm install

# Copy frontend source and build
COPY frontend/ .
RUN npm run build

# =============================================================================
# Stage 2: Backend Build
# =============================================================================
FROM golang:1.25-alpine AS backend-builder

WORKDIR /app

# Install git for go mod download
RUN apk add --no-cache git

# Copy go mod files first (better layer caching)
COPY backend/go.mod backend/go.sum ./
RUN go mod download

# Copy backend source
COPY backend/ .

# Build binary with optimizations
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s" \
    -o /contractdiff \
    main.go

# =============================================================================
# Stage 3: Final Image
# =============================================================================
FROM alpine:3.21

WORKDIR /app

# Install runtime dependencies
RUN apk --no-cache add ca-certificates tzdata wget

# Set timezone
ENV TZ=Asia/Shanghai

# Copy binary from backend builder
COPY --from=backend-builder /contractdiff .

# Copy frontend dist from frontend builder
COPY --from=frontend-builder /app/frontend/dist ./static

# Copy config template
COPY backend/config.yaml ./config.yaml

# Create non-root user for security
RUN adduser -D -u 1000 appuser && \
    chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost:8080/ || exit 1

# Run
CMD ["./contractdiff"]
