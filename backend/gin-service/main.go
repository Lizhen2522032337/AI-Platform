package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"gin-service/internal/auth"
	"gin-service/internal/config"
	"gin-service/internal/realtime"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

func main() {
	// 所有配置均来自容器环境变量；Load 会在密钥或地址缺失时立即失败。
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	redisClient := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddress,
		Password: cfg.RedisPassword,
	})
	defer redisClient.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := redisClient.Ping(ctx).Err(); err != nil {
		log.Fatal("failed to connect to redis")
	}
	log.Printf("Redis connection ready: address=%s", cfg.RedisAddress)

	// gin.Default 自带访问日志与 panic 恢复中间件；业务接口再记录任务级关键状态。
	router := gin.Default()
	authenticator := auth.New(
		cfg.JWTSecret,
		cfg.JWTIssuer,
		cfg.JWTAudience,
		cfg.JWTCookieName,
		auth.NewRedisVersionStore(redisClient),
	)
	realtime.NewHandler(realtime.NewRedisStore(redisClient)).RegisterRoutes(router, authenticator.Require())
	server := &http.Server{
		Addr:              ":8080",
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      0, // SSE 长连接不能设置普通写超时。
	}

	go func() {
		log.Printf("Gin realtime service listening: address=%s", server.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("HTTP server failed: %v", err)
			stop()
		}
	}()

	<-ctx.Done()
	log.Printf("shutdown signal received; draining SSE connections")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("HTTP server shutdown failed: %v", err)
	} else {
		log.Printf("Gin realtime service stopped")
	}
}
