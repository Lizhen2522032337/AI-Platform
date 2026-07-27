package config

import (
	"fmt"
	"os"
)

// Config 保存 Gin 实时服务所需的 Redis 配置。
type Config struct {
	RedisAddress  string
	RedisPassword string
	JWTSecret     string
	JWTIssuer     string
	JWTAudience   string
	JWTCookieName string
}

// Load 从环境变量读取配置。
func Load() (Config, error) {
	password := os.Getenv("REDIS_PASSWORD")
	if password == "" {
		return Config{}, fmt.Errorf("REDIS_PASSWORD is required")
	}
	jwtSecret := os.Getenv("JWT_SECRET")
	if len(jwtSecret) < 32 {
		return Config{}, fmt.Errorf("JWT_SECRET is required and must contain at least 32 bytes")
	}
	return Config{
		RedisAddress:  envOrDefault("REDIS_HOST", "redis") + ":" + envOrDefault("REDIS_PORT", "6379"),
		RedisPassword: password,
		JWTSecret:     jwtSecret,
		JWTIssuer:     envOrDefault("JWT_ISSUER", "enterprise-ai-platform"),
		JWTAudience:   envOrDefault("JWT_AUDIENCE", "enterprise-ai-platform-web"),
		JWTCookieName: envOrDefault("JWT_COOKIE_NAME", "eai_access"),
	}, nil
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
