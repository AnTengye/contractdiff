# Contract Diff - Docker Build Makefile

# Configuration
APP_NAME := contractdiff
IMAGE := as2674as/contractdiff
VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")

# Build info
BUILD_TIME := $(shell date -u '+%Y-%m-%d_%H:%M:%S')
GIT_COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")

.PHONY: help build push deploy clean run dev

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

build: ## Build Docker image
	@echo "Building Docker image: $(IMAGE):$(VERSION)"
	docker build -t $(IMAGE):$(VERSION) -t $(IMAGE):latest .
	@echo "Build complete: $(IMAGE):$(VERSION)"

push: ## Push Docker image to registry
	@echo "Pushing to $(REGISTRY)..."
	docker push $(IMAGE):$(VERSION)
	docker push $(IMAGE):latest
	@echo "Push complete"

deploy: build push ## Build and push Docker image
	@echo "Deployment complete: $(IMAGE):$(VERSION)"

clean: ## Remove local Docker images
	@echo "Removing local images..."
	-docker rmi $(IMAGE):$(VERSION) 2>/dev/null
	-docker rmi $(IMAGE):latest 2>/dev/null
	@echo "Clean complete"

run: ## Run Docker container locally
	docker run -d \
		--name $(APP_NAME) \
		-p 8080:8080 \
		-v $(PWD)/backend/config.yaml:/app/config.yaml:ro \
		$(IMAGE):latest
	@echo "Container started on http://localhost:8080"

stop: ## Stop and remove local container
	-docker stop $(APP_NAME) 2>/dev/null
	-docker rm $(APP_NAME) 2>/dev/null
	@echo "Container stopped"

dev: ## Run development server
	cd backend && go run main.go

logs: ## Show container logs
	docker logs -f $(APP_NAME)

# Build for multiple platforms
build-multi: ## Build multi-platform images
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		-t $(IMAGE):$(VERSION) \
		-t $(IMAGE):latest \
		--push .

# Show current version
version: ## Show current version
	@echo "Version: $(VERSION)"
	@echo "Image: $(IMAGE):$(VERSION)"
	@echo "Git Commit: $(GIT_COMMIT)"
	@echo "Build Time: $(BUILD_TIME)"
