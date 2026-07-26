package items

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type fakeRepository struct {
	items []Item
}

func (f *fakeRepository) Health(context.Context) error { return nil }
func (f *fakeRepository) List(context.Context) ([]Item, error) {
	return f.items, nil
}
func (f *fakeRepository) Get(_ context.Context, id int) (Item, error) {
	for _, item := range f.items {
		if item.ID == id {
			return item, nil
		}
	}
	return Item{}, ErrNotFound
}
func (f *fakeRepository) Create(_ context.Context, payload Payload) (Item, error) {
	return testItem(1, payload), nil
}
func (f *fakeRepository) Update(_ context.Context, id int, payload Payload) (Item, error) {
	if id != 1 {
		return Item{}, ErrNotFound
	}
	return testItem(id, payload), nil
}
func (f *fakeRepository) Delete(_ context.Context, id int) error {
	if id != 1 {
		return ErrNotFound
	}
	return nil
}

func testItem(id int, payload Payload) Item {
	now := time.Date(2026, 7, 25, 0, 0, 0, 0, time.UTC)
	return Item{
		ID:          id,
		Name:        payload.Name,
		Description: payload.Description,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
}

func testRouter(repository Repository) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	NewHandler(repository).RegisterRoutes(router)
	return router
}

func performRequest(router http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	var payload bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&payload).Encode(body)
	}
	request := httptest.NewRequest(method, path, &payload)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func TestListItems(t *testing.T) {
	repository := &fakeRepository{items: []Item{testItem(1, Payload{Name: "测试", Description: "说明"})}}
	response := performRequest(testRouter(repository), http.MethodGet, "/items", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.Code)
	}
}

func TestCreateItemReturns201(t *testing.T) {
	response := performRequest(
		testRouter(&fakeRepository{}),
		http.MethodPost,
		"/items",
		Payload{Name: " 测试 ", Description: "说明"},
	)
	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", response.Code)
	}
}

func TestBlankNameReturns400(t *testing.T) {
	response := performRequest(
		testRouter(&fakeRepository{}),
		http.MethodPost,
		"/items",
		Payload{Name: "   ", Description: ""},
	)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", response.Code)
	}
}

func TestMissingItemReturns404(t *testing.T) {
	response := performRequest(testRouter(&fakeRepository{}), http.MethodGet, "/items/999", nil)
	if response.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", response.Code)
	}
}

func TestDeleteReturns204(t *testing.T) {
	response := performRequest(testRouter(&fakeRepository{}), http.MethodDelete, "/items/1", nil)
	if response.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", response.Code)
	}
	if response.Body.Len() != 0 {
		t.Fatalf("expected empty response body, got %q", response.Body.String())
	}
}
