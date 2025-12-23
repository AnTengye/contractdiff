package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/AnTengye/contractdiff/backend/handler"
	"github.com/AnTengye/contractdiff/backend/middleware"
	"github.com/AnTengye/contractdiff/backend/pkg/logger"
	"github.com/AnTengye/contractdiff/backend/service"
	"github.com/gin-gonic/gin"
)

func main() {
	// Load configuration
	cfg, err := config.Load("config.yaml")
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	// Initialize logger
	logger.Init(&logger.Config{
		Level:  cfg.Log.Level,
		Format: cfg.Log.Format,
	})

	slog.Info("configuration loaded successfully")

	// Initialize services
	minioSvc, err := service.NewMinioService(&cfg.Minio)
	if err != nil {
		slog.Error("failed to initialize MINIO service", "error", err)
		os.Exit(1)
	}

	// Ensure bucket exists
	if err := minioSvc.EnsureBucket(context.Background()); err != nil {
		slog.Error("failed to ensure MINIO bucket", "error", err)
		os.Exit(1)
	}

	mineruSvc := service.NewMineruService(&cfg.Mineru)

	// Initialize contract store with config
	service.InitContractStore(&cfg.Store)

	// Initialize handlers
	authHandler := handler.NewAuthHandler(cfg)
	contractHandler := handler.NewContractHandler(minioSvc, mineruSvc)
	callbackHandler := handler.NewCallbackHandler(mineruSvc)

	// Setup Gin router
	gin.SetMode(gin.ReleaseMode)
	router := gin.New() // Use New() instead of Default() to avoid default middleware

	// Add custom middleware
	router.Use(middleware.RequestID())                 // Request ID for tracing
	router.Use(middleware.Recovery())                  // Panic recovery
	router.Use(middleware.RequestLogger())             // Access logging
	router.Use(corsMiddleware())                       // CORS
	router.Use(cacheMiddleware())                      // Cache control
	router.Use(middleware.RateLimit(100, time.Minute)) // Rate limiting: 100 requests per minute

	// Determine static files directory
	staticDir := "./"
	if _, err := os.Stat("./index.html"); os.IsNotExist(err) {
		staticDir = "../"
	}
	slog.Info("serving static files", "directory", staticDir)

	// Serve static files
	router.Static("/static", staticDir)
	router.StaticFile("/", staticDir+"index.html")
	router.StaticFile("/login.html", staticDir+"login.html")
	router.StaticFile("/index.html", staticDir+"index.html")
	router.StaticFile("/app.js", staticDir+"app.js")
	router.StaticFile("/styles.css", staticDir+"styles.css")

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "ok",
			"timestamp": time.Now().Format(time.RFC3339),
		})
	})

	// Public routes
	api := router.Group("/api")
	{
		api.POST("/auth/login", authHandler.Login)
		api.POST("/mineru/callback", callbackHandler.HandleCallback)
	}

	// Protected routes
	protected := api.Group("/")
	protected.Use(middleware.AuthMiddleware(&cfg.Auth))
	{
		protected.GET("/auth/me", authHandler.GetCurrentUser)
		protected.POST("/contracts/upload", contractHandler.Upload)
		protected.GET("/contracts", contractHandler.List)
		protected.GET("/contracts/:id", contractHandler.Get)
		protected.GET("/contracts/:id/status", contractHandler.GetStatus)
		protected.DELETE("/contracts/:id", contractHandler.Delete)
	}

	// Create server
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Server.Port),
		Handler:      router,
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Start server in goroutine
	go func() {
		slog.Info("server starting", "port", cfg.Server.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("failed to start server", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for interrupt signal to gracefully shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	slog.Info("shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("server forced to shutdown", "error", err)
		os.Exit(1)
	}

	slog.Info("server exited gracefully")
}

// corsMiddleware handles CORS headers
func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With, X-Request-ID")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE")
		c.Writer.Header().Set("Access-Control-Expose-Headers", "X-Request-ID")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

// cacheMiddleware sets cache control headers for static files
func cacheMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path

		// Skip caching for API routes
		if strings.HasPrefix(path, "/api") {
			c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
			c.Header("Pragma", "no-cache")
			c.Header("Expires", "0")
			c.Next()
			return
		}

		// Set cache headers for static files (1 hour)
		if strings.HasSuffix(path, ".js") ||
			strings.HasSuffix(path, ".css") ||
			strings.HasSuffix(path, ".html") ||
			path == "/" {
			c.Header("Cache-Control", "public, max-age=3600, must-revalidate")
		}

		c.Next()
	}
}
