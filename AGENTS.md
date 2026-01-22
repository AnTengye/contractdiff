# AGENTS.md - Agentic Coding Guide for ContractDiff

This document provides essential context for AI coding agents working on this codebase.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:
1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes

## Project Overview

ContractDiff is a document comparison tool for contracts. It consists of:
- **Backend**: Go (Gin framework) - REST API, document parsing orchestration
- **Frontend**: TypeScript (Vite) - PDF viewer, diff visualization

## Repository Structure

```
contractdiff/
├── backend/           # Go backend
│   ├── main.go        # Entry point
│   ├── config/        # Configuration loading
│   ├── handler/       # HTTP handlers (controllers)
│   ├── middleware/    # Auth, rate limiting, logging
│   ├── model/         # Data models
│   ├── service/       # Business logic
│   │   ├── parser/    # Document parsers (MinerU, PaddleOCR)
│   │   └── converter/ # Format converters (Gotenberg)
│   └── pkg/           # Shared packages (logger, notify)
├── frontend/          # TypeScript frontend
│   ├── src/
│   │   ├── components/  # UI components
│   │   ├── features/    # Feature modules
│   │   ├── services/    # API clients, document processing
│   │   ├── store/       # State management
│   │   ├── types/       # TypeScript types
│   │   └── utils/       # Utilities
│   └── index.html
├── Makefile           # Docker build commands
└── docker-compose.yml # Container orchestration
```

## Build/Lint/Test Commands

### Backend (Go)

```bash
# Run development server
cd backend && go run main.go

# Run all tests
cd backend && go test ./...

# Run single test file
cd backend && go test ./handler/contract_test.go ./handler/contract.go

# Run specific test function
cd backend && go test -run TestUpload ./handler/...

# Run tests with verbose output
cd backend && go test -v ./...

# Run tests with coverage
cd backend && go test -cover ./...

# Format code
cd backend && go fmt ./...

# Lint (if golangci-lint installed)
cd backend && golangci-lint run
```

### Frontend (TypeScript)

```bash
# Install dependencies
cd frontend && npm install

# Development server
cd frontend && npm run dev

# Type checking
cd frontend && npm run typecheck

# Build for production
cd frontend && npm run build

# Preview production build
cd frontend && npm run preview
```

### Docker

```bash
make build     # Build Docker image
make run       # Run container locally
make stop      # Stop container
make dev       # Run Go development server
make logs      # Show container logs
```

## Code Style Guidelines

### Go (Backend)

**Imports**: Group in order: stdlib, external, internal
```go
import (
    "context"
    "fmt"
    
    "github.com/gin-gonic/gin"
    
    "github.com/AnTengye/contractdiff/backend/service"
)
```

**Naming**:
- Handlers: `ContractHandler`, methods like `Upload`, `Get`, `List`
- Services: `MinioService`, `ContractStore`
- Parsers implement `DocumentParser` interface

**Error Handling**:
- Always check errors immediately after function calls
- Use `slog` for structured logging with context
- Return user-friendly error messages in JSON responses

```go
if err != nil {
    slog.Error("operation failed", "request_id", requestID, "error", err)
    c.JSON(http.StatusInternalServerError, gin.H{"error": "User-friendly message"})
    return
}
```

**Logging**: Use `log/slog` with structured fields
```go
slog.Info("action completed", "contract_id", id, "duration_ms", elapsed)
```

### TypeScript (Frontend)

**Imports**: Use path aliases defined in tsconfig.json
```typescript
import { contractStore } from '@/store';
import type { ContractData } from '@/types';
```

**Path Aliases**:
- `@/*` → `src/*`
- `@types/*` → `src/types/*`
- `@store/*` → `src/store/*`
- `@services/*` → `src/services/*`

**TypeScript Config** (strict mode enabled):
- `noUnusedLocals`: true
- `noUnusedParameters`: true
- `noUncheckedIndexedAccess`: true
- `noFallthroughCasesInSwitch`: true

**Naming Conventions**:
- Components: PascalCase classes (`UploadCard`, `PdfViewer`)
- Services: camelCase functions (`uploadContract`, `getParsers`)
- Types: PascalCase interfaces (`ContractData`, `Parser`)
- Constants: SCREAMING_SNAKE_CASE (`API_ENDPOINTS`, `POLLING`)

**Error Handling**:
```typescript
try {
    const result = await apiCall();
} catch (error) {
    const message = error instanceof Error ? error.message : 'Operation failed';
    // Handle error
}
```

## API Conventions

### Backend Endpoints
- Auth: `/api/auth/login`, `/api/auth/me`
- Contracts: `/api/contracts/upload`, `/api/contracts/:id`
- Parsers: `/api/parsers`

### Request/Response Format
- Use `gin.H{}` for JSON responses
- Include `error` field for error responses
- Use snake_case for JSON field names

### Frontend-Backend Field Mapping
Backend returns snake_case, frontend uses camelCase internally:
- `parser_type` (backend) ↔ `parserId` (frontend)
- `json_data` (backend) ↔ `data` (frontend)

## Parser System

Parsers implement the `DocumentParser` interface:
```go
type DocumentParser interface {
    GetCapabilities() ParserCapabilities
    CanParse(format string) bool
    CreateTask(ctx, fileURL, docID string) (taskID string, error)
    GetTaskStatus(ctx, taskID string) (*TaskStatus, error)
    FetchResult(ctx, taskID, resultURL string) (map[string]interface{}, error)
    NormalizeResult(rawData map[string]interface{}) (map[string]interface{}, error)
}
```

Available parsers: `mineru`, `paddleocr`

## Common Gotchas

1. **Parser Selection**: Frontend sends `parser_type` form field, not `parser_id`
2. **CORS**: Backend proxies PDFs via `/api/contracts/:id/pdf` to bypass CORS
3. **Async Processing**: Document parsing is async - use polling for status
4. **File Deduplication**: Backend deduplicates by SHA256 hash per tenant

## Testing Patterns

### Go Tests
```go
func TestHandler(t *testing.T) {
    // Setup
    router := setupTestRouter()
    
    // Execute
    w := httptest.NewRecorder()
    req, _ := http.NewRequest("GET", "/api/endpoint", nil)
    router.ServeHTTP(w, req)
    
    // Assert
    assert.Equal(t, http.StatusOK, w.Code)
}
```

### Frontend Manual Testing
```javascript
// Available in browser console after app loads
window.testPdfHighlight()
```
