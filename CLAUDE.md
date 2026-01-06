# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ContractDiff is a web application for intelligent comparison of contract documents (PDF and DOCX). It uses:
- **Backend**: Go + Gin framework
- **Frontend**: Vanilla HTML/CSS/JavaScript (no framework)
- **Storage**: MinIO object storage
- **Document Processing**: MinerU API for intelligent document parsing
- **Authentication**: JWT-based with multi-tenant support

## Development Commands

### Running the Application

```bash
# Run development server (from backend/ directory)
cd backend && go run main.go

# Or from root using Makefile
make dev
```

The server runs on port 8080 by default (configurable in `backend/config.yaml`).

### Testing

```bash
# Run all tests
cd backend && go test ./...

# Run tests for a specific package
cd backend && go test ./handler
cd backend && go test ./service
cd backend && go test ./middleware

# Run tests with verbose output
cd backend && go test -v ./...

# Run a single test
cd backend && go test -v -run TestFunctionName ./package
```

### Building

```bash
# Build the backend binary
cd backend && go build -o contractdiff.exe main.go

# Docker build
make build

# Build and push to registry
make deploy
```

### Docker Operations

```bash
# Run with Docker
make run          # Runs on port 28080

# Stop container
make stop

# View logs
make logs

# Build multi-platform images
make build-multi
```

## Architecture

### Backend Structure

The backend follows a clean architecture pattern with clear separation of concerns:

- **`config/`**: Configuration management using YAML. The `Config` struct centralizes all application settings (server, MinIO, MinerU, auth, notifications).

- **`handler/`**: HTTP request handlers (controllers). Each handler is responsible for a specific domain:
  - `auth.go`: Login and user authentication
  - `contract.go`: Contract upload, listing, retrieval, deletion
  - `callback.go`: MinerU callback handling for async processing results

- **`middleware/`**: Gin middleware components:
  - `auth.go`: JWT token validation and user context injection
  - `rate_limit.go`: Rate limiting (100 req/min default)
  - `recovery.go`: Panic recovery
  - `request_id.go`: Request ID tracking for distributed tracing
  - `request_logger.go`: Access logging

- **`model/`**: Data models and domain objects
  - `contract.go`: Contract entity with statuses (pending, processing, completed, failed)

- **`service/`**: Business logic layer:
  - `minio.go`: MinIO client wrapper for file upload/download/presigned URLs
  - `mineru.go`: MinerU API client for document extraction tasks
  - `store.go`: In-memory contract store (thread-safe with RWMutex). **Note**: This is in-memory only; consider replacing with a database for production.
  - `token_checker.go`: Background service that monitors MinerU token expiration and sends notifications

- **`pkg/`**: Reusable packages:
  - `logger/`: Structured logging configuration (slog)
  - `notify/`: Notification system supporting DingTalk and Feishu webhooks

### Key Workflows

#### Contract Upload Flow
1. User uploads PDF/DOCX via `/api/contracts/upload`
2. File validation (extension, content type)
3. Upload to MinIO with tenant-scoped path: `{tenant}/{contractID}/{filename}`
4. Generate presigned URL (expires based on config)
5. Create contract record in store with "pending" status
6. Asynchronously call MinerU API to create extraction task
7. Poll MinerU task status (5s intervals, max 5 minutes)
8. On completion, download ZIP, extract JSON, update contract with "completed" status

#### Authentication Flow
1. User posts credentials to `/api/auth/login`
2. Username/password validated against config.yaml users
3. JWT token generated with username and tenant claims
4. Token expires after `token_expire_hours` (default 24h)
5. Protected routes use `AuthMiddleware` to validate token and inject user context

#### Multi-tenancy
- Each user belongs to a tenant (configured in config.yaml)
- JWT tokens include tenant claim
- Contract operations are scoped to the current user's tenant
- MinIO storage is organized by tenant

#### Token Expiration Monitoring
- Background service (`TokenChecker`) monitors MinerU API token expiration
- Configured via `mineru.token_created_at` (RFC3339 format) and `mineru.token_valid_days`
- Sends notifications via DingTalk/Feishu at 7, 3, 1, and 0 days before expiration
- Checks run every `notification.check_interval_hours` (default 12h)

### Configuration

Configuration is stored in `backend/config.yaml`. Key sections:

- **server**: Port configuration
- **minio**: Object storage connection (endpoint, credentials, bucket, SSL, expiry)
- **mineru**: MinerU API settings (URL, token, model version, callback URL, token expiration tracking)
- **auth**: JWT secret and token expiration
- **log**: Logging level (debug/info/warn/error) and format (json/text)
- **store**: In-memory store limits (max_contracts)
- **notification**: DingTalk and Feishu webhook URLs for token expiration alerts
- **users**: Array of users with username, password, and tenant

**Important**: Copy `backend/config.example.yaml` to `backend/config.yaml` before running.

### Error Handling

The MinerU service includes comprehensive error handling:
- Error codes are parsed (can be string like "A0202" or int like -60012)
- Authentication errors (A0202, A0211) are detected and handled separately
- User-friendly error messages are provided via `GetMineruErrorMessage()`
- Task polling stops immediately on auth errors to avoid wasting API calls

### In-Memory Storage Limitation

The `ContractStore` is **in-memory only** and will lose all data on restart. For production:
- Replace with a persistent database (PostgreSQL, MySQL, MongoDB, etc.)
- Update service layer to use database queries instead of map operations
- Maintain the same interface to minimize handler changes

### Frontend

Frontend is in the root directory (index.html, app.js, styles.css, login.html):
- No build step required
- Static files served by Gin
- Pure JavaScript (no frameworks)
- Communicates with backend via REST API

### API Endpoints

All API routes are under `/api`:

**Public:**
- `POST /api/auth/login` - User login
- `POST /api/mineru/callback` - MinerU callback (webhook)

**Protected (requires JWT):**
- `GET /api/auth/me` - Get current user info
- `POST /api/contracts/upload` - Upload contract file
- `GET /api/contracts` - List contracts for current tenant
- `GET /api/contracts/:id` - Get contract details with JSON data
- `GET /api/contracts/:id/status` - Get processing status
- `DELETE /api/contracts/:id` - Delete contract

### Middleware Stack

Request flow through middleware (in order):
1. `RequestID()` - Adds X-Request-ID header for tracing
2. `Recovery()` - Panic recovery
3. `RequestLogger()` - Access logging
4. `corsMiddleware()` - CORS headers
5. `cacheMiddleware()` - Cache control (API: no-cache, static: 1h)
6. `RateLimit()` - Rate limiting (100 req/min)
7. `AuthMiddleware()` - JWT validation (protected routes only)

## Common Patterns

### Adding a New API Endpoint

1. Define handler method in `backend/handler/`
2. Add route in `backend/main.go` (under public or protected group)
3. Use `middleware.GetTenant(c)` and `middleware.GetRequestID(c)` for context
4. Return consistent JSON responses with appropriate HTTP status codes

### Adding Configuration

1. Add field to relevant struct in `backend/config/config.go`
2. Add default value in `Load()` function if needed
3. Update `backend/config.example.yaml`
4. Access via `cfg *config.Config` passed to services

### Logging

Use structured logging with `slog`:
```go
slog.Info("message", "key1", value1, "key2", value2)
slog.Error("error message", "error", err, "context", data)
slog.Debug("debug info", "details", info)
```

Log levels: debug, info, warn, error (configured in config.yaml)

### Working with MinerU API

- All MinerU interactions go through `service.MineruService`
- Check for auth errors: `service.IsMineruAuthError(err)`
- Use user-friendly messages: `service.GetMineruErrorMessage(err)`
- The service handles both polling and callback-based workflows
