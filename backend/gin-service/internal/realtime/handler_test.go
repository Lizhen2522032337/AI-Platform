package realtime

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

type fakeStore struct {
	value string
	err   error
}

func (f *fakeStore) Ping(context.Context) error { return f.err }
func (f *fakeStore) Get(context.Context, string) (string, error) {
	return f.value, f.err
}

func testRouter(store Store) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	NewHandler(store).RegisterRoutes(router)
	return router
}

func TestHealth(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()
	testRouter(&fakeStore{}).ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.Code)
	}
}

func TestCurrentState(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/events/7/current", nil)
	response := httptest.NewRecorder()
	testRouter(&fakeStore{value: `{"id":7,"status":"processing"}`}).ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.Code)
	}
}

func TestRedisFailure(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()
	testRouter(&fakeStore{err: errors.New("offline")}).ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", response.Code)
	}
}
