package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// Store 隔离 HTTP 层与 Redis 客户端，便于单元测试。
type Store interface {
	Ping(context.Context) error
	Get(context.Context, string) (string, error)
}

// RedisStore 实现任务状态读取。
type RedisStore struct {
	client *redis.Client
}

// NewRedisStore 创建 Redis 状态仓储。
func NewRedisStore(client *redis.Client) *RedisStore {
	return &RedisStore{client: client}
}

// Ping 检查 Redis 连接。
func (s *RedisStore) Ping(ctx context.Context) error {
	return s.client.Ping(ctx).Err()
}

// Get 查询单个任务的最新状态。
func (s *RedisStore) Get(ctx context.Context, key string) (string, error) {
	return s.client.Get(ctx, key).Result()
}

// Handler 提供健康检查、当前状态和 SSE 事件接口。
type Handler struct {
	store Store
}

// NewHandler 创建实时接口 Handler。
func NewHandler(store Store) *Handler {
	return &Handler{store: store}
}

// RegisterRoutes 注册 Gin 实时服务路由。
func (h *Handler) RegisterRoutes(router *gin.Engine) {
	router.GET("/", h.root)
	router.GET("/health", h.health)
	router.GET("/events/:id/current", h.current)
	router.GET("/events/:id", h.events)
}

func (h *Handler) root(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"service": "gin-service",
		"role":    "realtime-service",
		"status":  "running",
	})
}

func (h *Handler) health(c *gin.Context) {
	if err := h.store.Ping(c.Request.Context()); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "error", "redis": "unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "gin-service", "redis": "ok"})
}

func taskKey(c *gin.Context) (string, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{
			"code": "VALIDATION_ERROR", "message": "id must be a positive integer",
		}})
		return "", false
	}
	return fmt.Sprintf("task:%d", id), true
}

func (h *Handler) current(c *gin.Context) {
	key, ok := taskKey(c)
	if !ok {
		return
	}
	value, err := h.store.Get(c.Request.Context(), key)
	if errors.Is(err, redis.Nil) {
		c.JSON(http.StatusNotFound, gin.H{"error": gin.H{"code": "NOT_FOUND", "message": "task state not found"}})
		return
	}
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": gin.H{"code": "REDIS_ERROR", "message": "task state unavailable"}})
		return
	}
	c.Data(http.StatusOK, "application/json; charset=utf-8", []byte(value))
}

func (h *Handler) events(c *gin.Context) {
	key, ok := taskKey(c)
	if !ok {
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.Status(http.StatusInternalServerError)
		return
	}
	lastValue := ""
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		value, err := h.store.Get(c.Request.Context(), key)
		if err == nil && value != lastValue {
			_, _ = fmt.Fprintf(c.Writer, "event: task\ndata: %s\n\n", value)
			flusher.Flush()
			lastValue = value
			var state struct {
				Status string `json:"status"`
			}
			if json.Unmarshal([]byte(value), &state) == nil && (state.Status == "completed" || state.Status == "failed") {
				return
			}
		}
		select {
		case <-c.Request.Context().Done():
			return
		case <-ticker.C:
		}
	}
}
