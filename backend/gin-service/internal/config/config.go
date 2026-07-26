package config

import (
	"fmt"
	"os"
)

// Config 保存 Gin 实时服务所需的 Redis 配置。
type Config struct {
	RedisAddress  string
	RedisPassword string
}

// Load 从环境变量读取配置。
func Load() (Config, error) {
	password := os.Getenv("REDIS_PASSWORD")
	if password == "" {
		return Config{}, fmt.Errorf("REDIS_PASSWORD is required")
	}
	return Config{
		RedisAddress:  envOrDefault("REDIS_HOST", "redis") + ":" + envOrDefault("REDIS_PORT", "6379"),
		RedisPassword: password,
	}, nil
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
