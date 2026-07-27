package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "0123456789abcdef0123456789abcdef"

type fakeVersions struct {
	version int
}

func (f fakeVersions) TokenVersion(context.Context, int) (int, error) {
	return f.version, nil
}

func signedToken(t *testing.T, expiresAt time.Time) string {
	t.Helper()
	claims := Claims{
		Username:    "tester",
		Role:        "user",
		Permissions: []string{"tasks:read:own"},
		Version:     1,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "7",
			Issuer:    "enterprise-ai-platform",
			Audience:  jwt.ClaimStrings{"enterprise-ai-platform-web"},
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func TestRequireAcceptsValidCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	authenticator := New(testSecret, "enterprise-ai-platform", "enterprise-ai-platform-web", "eai_access", fakeVersions{version: 1})
	router.GET("/protected", authenticator.Require(), func(c *gin.Context) {
		principal, ok := PrincipalFrom(c)
		if !ok || principal.UserID != 7 || !SessionValid(c) {
			c.Status(http.StatusInternalServerError)
			return
		}
		c.Status(http.StatusOK)
	})

	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.AddCookie(&http.Cookie{Name: "eai_access", Value: signedToken(t, time.Now().Add(time.Hour))})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.Code)
	}
}

func TestRequireRejectsExpiredToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	authenticator := New(testSecret, "enterprise-ai-platform", "enterprise-ai-platform-web", "eai_access", fakeVersions{version: 1})
	router.GET("/protected", authenticator.Require(), func(c *gin.Context) { c.Status(http.StatusOK) })

	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.AddCookie(&http.Cookie{Name: "eai_access", Value: signedToken(t, time.Now().Add(-time.Minute))})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", response.Code)
	}
}
