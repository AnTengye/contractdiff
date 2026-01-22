package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

const (
	maxRetries    = 3
	retryBaseWait = 100 * time.Millisecond
)

type MinioService struct {
	client *minio.Client
	bucket string
	config *config.MinioConfig
}

func NewMinioService(cfg *config.MinioConfig) (*MinioService, error) {
	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create minio client: %w", err)
	}

	return &MinioService{
		client: client,
		bucket: cfg.Bucket,
		config: cfg,
	}, nil
}

func (s *MinioService) EnsureBucket(ctx context.Context) error {
	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			wait := retryBaseWait * time.Duration(1<<(attempt-1))
			slog.Warn("retrying MinIO bucket check", "attempt", attempt+1, "bucket", s.bucket, "wait", wait)
			time.Sleep(wait)
		}

		exists, err := s.client.BucketExists(ctx, s.bucket)
		if err != nil {
			lastErr = err
			if isRetryableError(err) {
				continue
			}
			return fmt.Errorf("failed to check bucket: %w", err)
		}

		if !exists {
			err = s.client.MakeBucket(ctx, s.bucket, minio.MakeBucketOptions{})
			if err != nil {
				lastErr = err
				if isRetryableError(err) {
					continue
				}
				return fmt.Errorf("failed to create bucket: %w", err)
			}
		}

		return nil
	}

	return fmt.Errorf("failed to ensure bucket after %d attempts: %w", maxRetries, lastErr)
}

func isRetryableError(err error) bool {
	if err == nil {
		return false
	}
	errStr := err.Error()
	return strings.Contains(errStr, "http: server gave HTTP response to HTTPS client") ||
		strings.Contains(errStr, "connection reset") ||
		strings.Contains(errStr, "connection refused") ||
		strings.Contains(errStr, "i/o timeout") ||
		strings.Contains(errStr, "EOF") ||
		strings.Contains(errStr, "503") ||
		strings.Contains(errStr, "Service Unavailable") ||
		strings.Contains(errStr, "502") ||
		strings.Contains(errStr, "Bad Gateway")
}

func (s *MinioService) UploadFile(ctx context.Context, objectName string, reader io.Reader, size int64, contentType string) error {
	data, err := io.ReadAll(reader)
	if err != nil {
		return fmt.Errorf("failed to read file data: %w", err)
	}

	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			wait := retryBaseWait * time.Duration(1<<(attempt-1))
			slog.Warn("retrying MinIO upload", "attempt", attempt+1, "object", objectName, "wait", wait)
			time.Sleep(wait)
		}

		_, lastErr = s.client.PutObject(ctx, s.bucket, objectName, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{
			ContentType: contentType,
		})
		if lastErr == nil {
			return nil
		}

		if !isRetryableError(lastErr) {
			break
		}
	}

	return fmt.Errorf("failed to upload file after %d attempts: %w", maxRetries, lastErr)
}

// GetPresignedURL generates a presigned URL for the object with expiration
func (s *MinioService) GetPresignedURL(ctx context.Context, objectName string) (string, error) {
	expiry := time.Duration(s.config.ExpireDays) * 24 * time.Hour
	url, err := s.client.PresignedGetObject(ctx, s.bucket, objectName, expiry, nil)
	if err != nil {
		return "", fmt.Errorf("failed to generate presigned URL: %w", err)
	}

	return url.String(), nil
}

// DeleteFile deletes a file from MINIO
func (s *MinioService) DeleteFile(ctx context.Context, objectName string) error {
	err := s.client.RemoveObject(ctx, s.bucket, objectName, minio.RemoveObjectOptions{})
	if err != nil {
		return fmt.Errorf("failed to delete file: %w", err)
	}

	return nil
}

// GetPublicURL returns a public URL for the object (if bucket policy allows)
func (s *MinioService) GetPublicURL(objectName string) string {
	protocol := "http"
	if s.config.UseSSL {
		protocol = "https"
	}
	return fmt.Sprintf("%s://%s/%s/%s", protocol, s.config.Endpoint, s.bucket, objectName)
}

func (s *MinioService) UploadBytes(ctx context.Context, objectName string, data []byte, contentType string) (string, error) {
	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			wait := retryBaseWait * time.Duration(1<<(attempt-1))
			slog.Warn("retrying MinIO upload bytes", "attempt", attempt+1, "object", objectName, "wait", wait)
			time.Sleep(wait)
		}

		_, lastErr = s.client.PutObject(ctx, s.bucket, objectName, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{
			ContentType: contentType,
		})
		if lastErr == nil {
			return s.GetPresignedURL(ctx, objectName)
		}

		if !isRetryableError(lastErr) {
			break
		}
	}

	return "", fmt.Errorf("failed to upload bytes after %d attempts: %w", maxRetries, lastErr)
}
