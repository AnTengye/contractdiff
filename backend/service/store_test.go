package service

import (
	"testing"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/AnTengye/contractdiff/backend/model"
)

func newTestStore(maxContracts int) *ContractStore {
	return &ContractStore{
		contracts:    make(map[string]*model.Contract),
		maxContracts: maxContracts,
	}
}

func TestContractStoreSaveAndGet(t *testing.T) {
	store := newTestStore(100)

	contract := &model.Contract{
		ID:        "test-id-1",
		Filename:  "test.pdf",
		Tenant:    "tenant1",
		Status:    model.StatusPending,
		CreatedAt: time.Now(),
	}

	store.Save(contract)

	// Test Get
	retrieved := store.Get("test-id-1")
	if retrieved == nil {
		t.Fatal("Expected to retrieve contract")
	}
	if retrieved.Filename != "test.pdf" {
		t.Errorf("Expected filename test.pdf, got %s", retrieved.Filename)
	}

	// Test Get non-existent
	notFound := store.Get("non-existent")
	if notFound != nil {
		t.Error("Expected nil for non-existent contract")
	}
}

func TestContractStoreGetByTenant(t *testing.T) {
	store := newTestStore(100)

	// Add contracts for different tenants
	store.Save(&model.Contract{ID: "1", Tenant: "tenant1", CreatedAt: time.Now()})
	store.Save(&model.Contract{ID: "2", Tenant: "tenant1", CreatedAt: time.Now()})
	store.Save(&model.Contract{ID: "3", Tenant: "tenant2", CreatedAt: time.Now()})

	// Test GetByTenant
	tenant1Contracts := store.GetByTenant("tenant1")
	if len(tenant1Contracts) != 2 {
		t.Errorf("Expected 2 contracts for tenant1, got %d", len(tenant1Contracts))
	}

	tenant2Contracts := store.GetByTenant("tenant2")
	if len(tenant2Contracts) != 1 {
		t.Errorf("Expected 1 contract for tenant2, got %d", len(tenant2Contracts))
	}

	tenant3Contracts := store.GetByTenant("tenant3")
	if len(tenant3Contracts) != 0 {
		t.Errorf("Expected 0 contracts for tenant3, got %d", len(tenant3Contracts))
	}
}

func TestContractStoreDelete(t *testing.T) {
	store := newTestStore(100)

	store.Save(&model.Contract{ID: "delete-me", CreatedAt: time.Now()})

	if store.Get("delete-me") == nil {
		t.Fatal("Expected contract to exist before delete")
	}

	store.Delete("delete-me")

	if store.Get("delete-me") != nil {
		t.Error("Expected contract to be deleted")
	}
}

func TestContractStoreUpdateStatus(t *testing.T) {
	store := newTestStore(100)

	store.Save(&model.Contract{
		ID:        "status-test",
		Status:    model.StatusPending,
		CreatedAt: time.Now(),
	})

	store.UpdateStatus("status-test", model.StatusCompleted, "")

	contract := store.Get("status-test")
	if contract.Status != model.StatusCompleted {
		t.Errorf("Expected status %s, got %s", model.StatusCompleted, contract.Status)
	}

	// Test update with error message
	store.UpdateStatus("status-test", model.StatusFailed, "test error")
	contract = store.Get("status-test")
	if contract.ErrorMsg != "test error" {
		t.Errorf("Expected error msg 'test error', got '%s'", contract.ErrorMsg)
	}

	// Test update non-existent
	store.UpdateStatus("non-existent", model.StatusCompleted, "")
	// Should not panic
}

func TestContractStoreUpdateJSONData(t *testing.T) {
	store := newTestStore(100)

	store.Save(&model.Contract{
		ID:        "json-test",
		Status:    model.StatusProcessing,
		CreatedAt: time.Now(),
	})

	jsonData := map[string]interface{}{"key": "value"}
	store.UpdateJSONData("json-test", jsonData)

	contract := store.Get("json-test")
	if contract.Status != model.StatusCompleted {
		t.Errorf("Expected status %s, got %s", model.StatusCompleted, contract.Status)
	}
	if contract.JSONData == nil {
		t.Error("Expected JSON data to be set")
	}

	// Test update non-existent
	store.UpdateJSONData("non-existent", jsonData)
	// Should not panic
}

func TestContractStoreAutoCleanup(t *testing.T) {
	store := newTestStore(3) // Max 3 contracts

	// Add 5 contracts
	for i := 0; i < 5; i++ {
		store.Save(&model.Contract{
			ID:        string(rune('a' + i)),
			CreatedAt: time.Now().Add(time.Duration(i) * time.Second),
		})
		time.Sleep(10 * time.Millisecond) // Ensure different timestamps
	}

	// Should only have 3 contracts (newest)
	if store.Count() != 3 {
		t.Errorf("Expected 3 contracts after cleanup, got %d", store.Count())
	}

	// Oldest contracts should be removed
	if store.Get("a") != nil {
		t.Error("Expected oldest contract 'a' to be removed")
	}
	if store.Get("b") != nil {
		t.Error("Expected second oldest contract 'b' to be removed")
	}
}

func TestContractStoreUnlimitedContracts(t *testing.T) {
	store := newTestStore(0) // Unlimited

	// Add 10 contracts
	for i := 0; i < 10; i++ {
		store.Save(&model.Contract{
			ID:        string(rune('a' + i)),
			CreatedAt: time.Now(),
		})
	}

	// All should be present
	if store.Count() != 10 {
		t.Errorf("Expected 10 contracts, got %d", store.Count())
	}
}

func TestContractStoreCount(t *testing.T) {
	store := newTestStore(100)

	if store.Count() != 0 {
		t.Error("Expected 0 contracts initially")
	}

	store.Save(&model.Contract{ID: "1", CreatedAt: time.Now()})
	store.Save(&model.Contract{ID: "2", CreatedAt: time.Now()})

	if store.Count() != 2 {
		t.Errorf("Expected 2 contracts, got %d", store.Count())
	}
}

func TestGetContractStore(t *testing.T) {
	// Just test that GetContractStore returns a non-nil store
	store := GetContractStore()
	if store == nil {
		t.Fatal("Expected non-nil store")
	}
}

func TestInitContractStoreConfig(t *testing.T) {
	// Test InitContractStore with config
	cfg := &config.StoreConfig{MaxContracts: 50}
	InitContractStore(cfg)
	// Should not panic
}
