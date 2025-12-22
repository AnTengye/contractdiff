package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/AnTengye/contractdiff/backend/handler"
	"github.com/AnTengye/contractdiff/backend/middleware"
	"github.com/AnTengye/contractdiff/backend/service"
	"github.com/gin-gonic/gin"
)

func main() {
	// Load configuration
	cfg, err := config.Load("config.yaml")
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Initialize services
	minioSvc, err := service.NewMinioService(&cfg.Minio)
	if err != nil {
		log.Fatalf("Failed to initialize MINIO service: %v", err)
	}

	// Ensure bucket exists
	if err := minioSvc.EnsureBucket(context.Background()); err != nil {
		log.Fatalf("Failed to ensure MINIO bucket: %v", err)
	}

	mineruSvc := service.NewMineruService(&cfg.Mineru)

	// Initialize handlers
	authHandler := handler.NewAuthHandler(cfg)
	contractHandler := handler.NewContractHandler(minioSvc, mineruSvc)
	callbackHandler := handler.NewCallbackHandler(mineruSvc)

	// Setup Gin router
	gin.SetMode(gin.ReleaseMode)
	router := gin.Default()

	// CORS middleware
	router.Use(corsMiddleware())

	// Determine static files directory
	// In Docker, files are in current directory; in local dev, they're in parent directory
	staticDir := "./"
	if _, err := os.Stat("./index.html"); os.IsNotExist(err) {
		staticDir = "../"
	}
	log.Printf("Serving static files from: %s", staticDir)

	// Serve static files
	router.Static("/static", staticDir)
	router.StaticFile("/", staticDir+"index.html")
	router.StaticFile("/login.html", staticDir+"login.html")
	router.StaticFile("/index.html", staticDir+"index.html")
	router.StaticFile("/app.js", staticDir+"app.js")
	router.StaticFile("/styles.css", staticDir+"styles.css")

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
		Addr:    fmt.Sprintf(":%d", cfg.Server.Port),
		Handler: router,
	}

	// Start server in goroutine
	go func() {
		log.Printf("Server starting on port %d...", cfg.Server.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	// Wait for interrupt signal to gracefully shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown:", err)
	}

	log.Println("Server exited")
}

// corsMiddleware handles CORS headers
func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}
