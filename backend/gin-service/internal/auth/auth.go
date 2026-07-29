package auth

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
)

const (
	principalKey    = "authenticated-principal"
	sessionStoreKey = "session-version-store"
)

// Claims 是 NestJS 签发、Gin 验证的共享 JWT 载荷。
type Claims struct {
	Username    string   `json:"username"`
	Role        string   `json:"role"`
	Permissions []string `json:"permissions"`
	Version     int      `json:"ver"`
	jwt.RegisteredClaims
}

// Principal 保存当前登录人的身份和权限。
type Principal struct {
	UserID       int
	Username     string
	Role         string
	Permissions  map[string]struct{}
	TokenVersion int
	ExpiresAt    time.Time
}

// Authenticator 验证 Bearer Token 或 HttpOnly Cookie。
type Authenticator struct {
	secret     []byte
	issuer     string
	audience   string
	cookieName string
	versions   VersionStore
}

// VersionStore 让权限或账号变化后可以立即让旧 Token 失效。
type VersionStore interface {
	TokenVersion(context.Context, int) (int, error)
}

type RedisVersionStore struct {
	client *redis.Client
}

func NewRedisVersionStore(client *redis.Client) *RedisVersionStore {
	return &RedisVersionStore{client: client}
}

func (s *RedisVersionStore) TokenVersion(ctx context.Context, userID int) (int, error) {
	return s.client.Get(ctx, fmt.Sprintf("auth:user:%d:version", userID)).Int()
}

func New(secret, issuer, audience, cookieName string, versions VersionStore) *Authenticator {
	return &Authenticator{
		secret:     []byte(secret),
		issuer:     issuer,
		audience:   audience,
		cookieName: cookieName,
		versions:   versions,
	}
}

func (a *Authenticator) Require() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 浏览器通常使用 HttpOnly Cookie，服务间调用也可使用 Authorization Bearer Token。
		raw := a.tokenFromRequest(c)
		if raw == "" {
			log.Printf("authentication rejected: reason=missing_token client=%s", c.ClientIP())
			abort(c, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
			return
		}

		claims := &Claims{}
		parsed, err := jwt.ParseWithClaims(
			raw,
			claims,
			func(token *jwt.Token) (any, error) { return a.secret, nil },
			jwt.WithValidMethods([]string{"HS256"}),
			jwt.WithIssuer(a.issuer),
			jwt.WithAudience(a.audience),
			jwt.WithExpirationRequired(),
		)
		userID, idError := strconv.Atoi(claims.Subject)
		if err != nil || idError != nil || userID <= 0 || !parsed.Valid {
			log.Printf("authentication rejected: reason=invalid_or_expired client=%s", c.ClientIP())
			abort(c, http.StatusUnauthorized, "UNAUTHORIZED", "token invalid or expired")
			return
		}
		version, versionError := a.versions.TokenVersion(c.Request.Context(), userID)
		if versionError != nil || version != claims.Version {
			log.Printf("authentication rejected: reason=session_revoked user_id=%d", userID)
			abort(c, http.StatusUnauthorized, "UNAUTHORIZED", "session has been revoked")
			return
		}

		permissions := make(map[string]struct{}, len(claims.Permissions))
		for _, permission := range claims.Permissions {
			permissions[permission] = struct{}{}
		}
		c.Set(principalKey, Principal{
			UserID:       userID,
			Username:     claims.Username,
			Role:         claims.Role,
			Permissions:  permissions,
			TokenVersion: claims.Version,
			ExpiresAt:    claims.ExpiresAt.Time,
		})
		c.Set(sessionStoreKey, a.versions)
		log.Printf("authentication accepted: user_id=%d role=%s", userID, claims.Role)
		c.Next()
	}
}

func PrincipalFrom(c *gin.Context) (Principal, bool) {
	value, ok := c.Get(principalKey)
	if !ok {
		return Principal{}, false
	}
	principal, ok := value.(Principal)
	return principal, ok
}

// SetPrincipal 主要供可信中间件和单元测试写入已经验证的身份。
func SetPrincipal(c *gin.Context, principal Principal) {
	c.Set(principalKey, principal)
}

func CanReadTask(c *gin.Context, ownerID int) bool {
	// tasks:read:any 用于管理员审计；其他用户必须同时拥有 read:own 且 ownerID 匹配。
	principal, ok := PrincipalFrom(c)
	if !ok {
		return false
	}
	if _, allowed := principal.Permissions["tasks:read:any"]; allowed {
		return true
	}
	_, ownAllowed := principal.Permissions["tasks:read:own"]
	return ownAllowed && ownerID > 0 && principal.UserID == ownerID
}

// SessionValid 供 SSE 长连接周期性复查过期时间和即时撤销版本。
func SessionValid(c *gin.Context) bool {
	principal, ok := PrincipalFrom(c)
	if !ok || principal.ExpiresAt.IsZero() || !time.Now().Before(principal.ExpiresAt) {
		return false
	}
	value, ok := c.Get(sessionStoreKey)
	store, storeOK := value.(VersionStore)
	if !ok || !storeOK {
		return false
	}
	version, err := store.TokenVersion(c.Request.Context(), principal.UserID)
	return err == nil && version == principal.TokenVersion
}

func (a *Authenticator) tokenFromRequest(c *gin.Context) string {
	// Authorization 优先于 Cookie，便于未来接入可信的服务端调用方。
	header := c.GetHeader("Authorization")
	if strings.HasPrefix(header, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	}
	token, err := c.Cookie(a.cookieName)
	if err == nil {
		return token
	}
	return ""
}

func abort(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, gin.H{"error": gin.H{"code": code, "message": message}})
}
