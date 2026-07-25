package config

import (
	"fmt"
	"net"
	"net/url"
	"os"
)

// Config 保存 Gin 服务所需的 PostgreSQL 配置。
type Config struct {
	Host     string
	Port     string
	Database string
	User     string
	Password string
	SSLMode  string
}

// Load 从环境变量读取配置，并为非敏感字段提供开发默认值。
func Load() (Config, error) {
	cfg := Config{
		Host:     envOrDefault("POSTGRES_HOST", "host.docker.internal"),
		Port:     envOrDefault("POSTGRES_PORT", "5432"),
		Database: envOrDefault("POSTGRES_DB", "enterprise_ai_platform"),
		User:     envOrDefault("POSTGRES_USER", "postgres"),
		Password: os.Getenv("POSTGRES_PASSWORD"),
		SSLMode:  envOrDefault("POSTGRES_SSLMODE", "disable"),
	}
	if cfg.Password == "" {
		return Config{}, fmt.Errorf("POSTGRES_PASSWORD is required")
	}
	return cfg, nil
}

// ConnectionString 返回 pgx 使用的连接参数；调用方不得记录该字符串。
func (c Config) ConnectionString() string {
	connectionURL := &url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(c.User, c.Password),
		Host:   net.JoinHostPort(c.Host, c.Port),
		Path:   c.Database,
	}
	query := connectionURL.Query()
	query.Set("sslmode", c.SSLMode)
	query.Set("connect_timeout", "5")
	connectionURL.RawQuery = query.Encode()
	return connectionURL.String()
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
