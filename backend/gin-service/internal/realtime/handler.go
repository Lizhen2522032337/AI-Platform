package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"gin-service/internal/auth"
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
func (h *Handler) RegisterRoutes(router *gin.Engine, middleware ...gin.HandlerFunc) {
	router.GET("/", h.root)
	router.GET("/health", h.health)
	events := router.Group("/events")
	events.Use(middleware...)
	events.GET("/:id/current", h.current)
	events.GET("/:id", h.events)
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
	// 入口统一校验正整数，避免构造任意 Redis Key。
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
	payload, ok := authorizedPayload(c, value)
	if !ok {
		return
	}
	log.Printf("current task state returned: key=%s", key)
	c.Data(http.StatusOK, "application/json; charset=utf-8", payload)
}

func (h *Handler) events(c *gin.Context) {
	key, ok := taskKey(c)
	if !ok {
		return
	}
	log.Printf("SSE connection opened: key=%s", key)
	defer log.Printf("SSE connection closed: key=%s", key)
	// 禁止 Nginx 缓冲，否则大模型增量会积累后一次性显示。
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
	// 200ms 轮询让大模型增量回答接近实时展示，同时限制单连接 Redis 压力。
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()

	for {
		// 长连接建立后仍周期检查 JWT 过期时间和 Redis tokenVersion。
		if !auth.SessionValid(c) {
			log.Printf("SSE session expired or revoked: key=%s", key)
			return
		}
		value, err := h.store.Get(c.Request.Context(), key)
		if err == nil && value != lastValue {
			payload, allowed := authorizedPayload(c, value)
			if !allowed {
				return
			}
			_, _ = fmt.Fprintf(c.Writer, "event: task\ndata: %s\n\n", payload)
			flusher.Flush()
			lastValue = value
			var state struct {
				Status string `json:"status"`
			}
			if json.Unmarshal([]byte(value), &state) == nil && (state.Status == "completed" || state.Status == "failed") {
				log.Printf("SSE terminal state delivered: key=%s status=%s", key, state.Status)
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

func authorizedPayload(c *gin.Context, value string) ([]byte, bool) {
	// ownerId 只用于服务端鉴权，发送给浏览器前必须移除。
	var state map[string]any
	if err := json.Unmarshal([]byte(value), &state); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": gin.H{
			"code": "STATE_ERROR", "message": "task state unavailable",
		}})
		return nil, false
	}
	ownerValue, _ := state["ownerId"].(float64)
	if !auth.CanReadTask(c, int(ownerValue)) {
		c.JSON(http.StatusForbidden, gin.H{"error": gin.H{
			"code": "FORBIDDEN", "message": "task access denied",
		}})
		return nil, false
	}
	delete(state, "ownerId")
	payload, err := json.Marshal(state)
	if err != nil {
		c.Status(http.StatusInternalServerError)
		return nil, false
	}
	return payload, true
}
