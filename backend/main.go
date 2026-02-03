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
	"github.com/AnTengye/contractdiff/backend/pkg/notify"
	"github.com/AnTengye/contractdiff/backend/pkg/timing"
	"github.com/AnTengye/contractdiff/backend/service"
	"github.com/AnTengye/contractdiff/backend/service/converter"
	"github.com/AnTengye/contractdiff/backend/service/parser"
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

	mineruSvc := service.NewMineruService(cfg.Parsers.MinerU)

	// Initialize parser registry
	parserRegistry := parser.GetRegistry()

	// Register MinerU parser (if enabled)
	if cfg.Parsers.MinerU != nil && cfg.Parsers.MinerU.Enabled {
		mineruParser, err := parser.NewMineruParser(cfg.Parsers.MinerU)
		if err != nil {
			slog.Warn("failed to initialize MinerU parser", "error", err)
		} else {
			if err := parserRegistry.Register(mineruParser); err != nil {
				slog.Error("failed to register MinerU parser", "error", err)
			} else {
				slog.Info("MinerU parser registered")
			}
		}
	}

	// Register PaddleOCR parser (if enabled)
	if cfg.Parsers.PaddleOCR != nil && cfg.Parsers.PaddleOCR.Enabled {
		paddleParser, err := parser.NewPaddleOCRParser(cfg.Parsers.PaddleOCR)
		if err != nil {
			slog.Warn("failed to initialize PaddleOCR parser", "error", err)
		} else {
			if err := parserRegistry.Register(paddleParser); err != nil {
				slog.Error("failed to register PaddleOCR parser", "error", err)
			} else {
				slog.Info("PaddleOCR parser registered")
			}
		}
	}

	// TODO: Register GOT-OCR and RAGFlow parsers when implemented

	slog.Info("parser registry initialized", "registered_parsers", parserRegistry.Count())

	// Initialize Gotenberg converter (if enabled)
	var gotenbergConv *converter.GotenbergConverter
	if cfg.Gotenberg.Enabled {
		gotenbergConv, err = converter.NewGotenbergConverter(&cfg.Gotenberg)
		if err != nil {
			slog.Warn("Gotenberg converter not available", "error", err)
		} else {
			slog.Info("Gotenberg converter initialized", "url", cfg.Gotenberg.APIURL)
		}
	}

	// Initialize contract store with config
	service.InitContractStore(&cfg.Store)

	notifyManager := notify.NewManager(&cfg.Notification)
	tokenChecker := service.NewTokenChecker(cfg, notifyManager)
	tokenChecker.Start()

	var timingAlerter timing.Alerter
	if cfg.Timing.Enabled && cfg.Timing.EnableAlert {
		timingAlerter = timing.NewDingTalkAlerter(notifyManager, cfg.Timing.AlertCooldownMinutes)
		slog.Info("timing alerter initialized", "cooldown_minutes", cfg.Timing.AlertCooldownMinutes)
	} else {
		timingAlerter = &timing.NoopAlerter{}
	}

	authHandler := handler.NewAuthHandler(cfg)
	contractHandler := handler.NewContractHandler(minioSvc, parserRegistry, gotenbergConv, &cfg.Timing, timingAlerter)
	callbackHandler := handler.NewCallbackHandler(mineruSvc)
	parserHandler := handler.NewParserHandler(parserRegistry)

	gin.SetMode(gin.ReleaseMode)
	router := gin.New()

	router.Use(middleware.RequestID())
	router.Use(middleware.Recovery())
	router.Use(middleware.RequestLogger())
	if cfg.Timing.Enabled {
		timingMiddlewareCfg := timing.NewMiddlewareConfig(&cfg.Timing, timingAlerter)
		router.Use(timing.Middleware(timingMiddlewareCfg))
		slog.Info("timing middleware enabled",
			"request_threshold_ms", cfg.Timing.RequestThresholdMs,
			"async_threshold_ms", cfg.Timing.AsyncThresholdMs,
		)
	}
	router.Use(corsMiddleware())
	router.Use(cacheMiddleware())
	router.Use(middleware.RateLimit(100, time.Minute))

	// Determine static files directory (production: ./static, development: ../frontend/dist)
	staticDir := "./static/"
	if _, err := os.Stat(staticDir + "index.html"); os.IsNotExist(err) {
		staticDir = "../frontend/dist/"
	}
	slog.Info("serving static files", "directory", staticDir)

	// Serve Vite build output (assets directory contains hashed JS/CSS bundles)
	router.Static("/assets", staticDir+"assets")
	router.StaticFile("/", staticDir+"index.html")
	router.StaticFile("/login.html", staticDir+"login.html")
	router.StaticFile("/index.html", staticDir+"index.html")
	// Serve any additional static files at root level
	router.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		filePath := staticDir + path[1:]
		if _, err := os.Stat(filePath); err == nil {
			c.File(filePath)
			return
		}
		// SPA fallback: serve index.html for unmatched routes
		c.File(staticDir + "index.html")
	})

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
		// NEW: Parser discovery endpoints
		api.GET("/parsers", parserHandler.ListParsers)
		api.GET("/parsers/format", parserHandler.GetParsersForFormat)
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
		protected.GET("/contracts/:id/pdf", contractHandler.GetPDF)
		protected.DELETE("/contracts/:id/cache", contractHandler.InvalidateCache)
		protected.POST("/contracts/:id/renormalize", contractHandler.ReNormalize)
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

	// Stop token checker
	tokenChecker.Stop()

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
