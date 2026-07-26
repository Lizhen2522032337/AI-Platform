package items

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// Handler 将统一 API 契约映射到 Repository。
type Handler struct {
	repository Repository
}

// NewHandler 创建 CRUD Handler。
func NewHandler(repository Repository) *Handler {
	return &Handler{repository: repository}
}

// RegisterRoutes 注册根路径、健康检查和 CRUD 路由。
func (h *Handler) RegisterRoutes(router *gin.Engine) {
	router.GET("/", h.root)
	router.GET("/health", h.health)
	router.GET("/items", h.list)
	router.GET("/items/:id", h.get)
	router.POST("/items", h.create)
	router.PUT("/items/:id", h.update)
	router.DELETE("/items/:id", h.delete)
}

func (h *Handler) root(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "Gin running"})
}

func (h *Handler) health(c *gin.Context) {
	if err := h.repository.Health(c.Request.Context()); err != nil {
		h.databaseError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "database": "ok"})
}

func (h *Handler) list(c *gin.Context) {
	result, err := h.repository.List(c.Request.Context())
	if err != nil {
		h.databaseError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) get(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	item, err := h.repository.Get(c.Request.Context(), id)
	if err != nil {
		h.repositoryError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) create(c *gin.Context) {
	payload, ok := bindPayload(c)
	if !ok {
		return
	}
	item, err := h.repository.Create(c.Request.Context(), payload)
	if err != nil {
		h.databaseError(c, err)
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *Handler) update(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	payload, ok := bindPayload(c)
	if !ok {
		return
	}
	item, err := h.repository.Update(c.Request.Context(), id, payload)
	if err != nil {
		h.repositoryError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) delete(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	if err := h.repository.Delete(c.Request.Context(), id); err != nil {
		h.repositoryError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) repositoryError(c *gin.Context, err error) {
	if errors.Is(err, ErrNotFound) {
		respondError(c, http.StatusNotFound, "NOT_FOUND", "item not found")
		return
	}
	h.databaseError(c, err)
}

func (h *Handler) databaseError(c *gin.Context, err error) {
	log.Printf("database operation failed: %v", err)
	respondError(c, http.StatusInternalServerError, "DATABASE_ERROR", "database operation failed")
}

func parseID(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		respondError(c, http.StatusBadRequest, "VALIDATION_ERROR", "id must be a positive integer")
		return 0, false
	}
	return id, true
}

func bindPayload(c *gin.Context) (Payload, bool) {
	var payload Payload
	if err := c.ShouldBindJSON(&payload); err != nil {
		respondError(c, http.StatusBadRequest, "VALIDATION_ERROR", "invalid JSON body")
		return Payload{}, false
	}
	payload.Name = strings.TrimSpace(payload.Name)
	if payload.Name == "" || len([]rune(payload.Name)) > 120 {
		respondError(c, http.StatusBadRequest, "VALIDATION_ERROR", "name must contain 1 to 120 characters")
		return Payload{}, false
	}
	if len([]rune(payload.Description)) > 2000 {
		respondError(c, http.StatusBadRequest, "VALIDATION_ERROR", "description must not exceed 2000 characters")
		return Payload{}, false
	}
	return payload, true
}

func respondError(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{"error": gin.H{"code": code, "message": message}})
}
