# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Install git for go mod download
RUN apk add --no-cache git

# Copy go mod files
COPY backend/go.mod backend/go.sum ./
RUN go mod download

# Copy source code
COPY backend/ .

# Build binary
RUN CGO_ENABLED=0 GOOS=linux go build -o /contractdiff main.go

# Final stage
FROM alpine:3.19

WORKDIR /app

# Install ca-certificates for HTTPS
RUN apk --no-cache add ca-certificates tzdata

# Set timezone
ENV TZ=Asia/Shanghai

# Copy binary from builder
COPY --from=builder /contractdiff .

# Copy frontend files
COPY index.html .
COPY login.html .
COPY app.js .
COPY styles.css .

# Copy config template
COPY backend/config.yaml ./config.yaml

# Expose port
EXPOSE 8080

# Run
CMD ["./contractdiff"]
