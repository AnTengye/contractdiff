package service

import (
	"log/slog"
	"sort"
	"sync"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/AnTengye/contractdiff/backend/model"
)

// ContractStore is an in-memory store for contracts
// In production, this should be replaced with a database
type ContractStore struct {
	contracts    map[string]*model.Contract
	hashIndex    map[string]string // hash -> contract ID mapping for deduplication
	mu           sync.RWMutex
	maxContracts int // Maximum contracts to keep, 0 = unlimited
}

var (
	globalStore *ContractStore
	storeOnce   sync.Once
)

// InitContractStore initializes the global contract store with configuration
func InitContractStore(cfg *config.StoreConfig) {
	storeOnce.Do(func() {
		maxContracts := cfg.MaxContracts
		if maxContracts < 0 {
			maxContracts = 0
		}
		globalStore = &ContractStore{
			contracts:    make(map[string]*model.Contract),
			hashIndex:    make(map[string]string),
			maxContracts: maxContracts,
		}
		slog.Info("contract store initialized", "max_contracts", maxContracts)
	})
}

// GetContractStore returns the global contract store
func GetContractStore() *ContractStore {
	if globalStore == nil {
		// Fallback initialization with default settings
		globalStore = &ContractStore{
			contracts:    make(map[string]*model.Contract),
			hashIndex:    make(map[string]string),
			maxContracts: 100, // Default: keep 100 contracts
		}
	}
	return globalStore
}

func (s *ContractStore) Save(contract *model.Contract) {
	s.mu.Lock()
	defer s.mu.Unlock()

	contract.UpdatedAt = time.Now()
	s.contracts[contract.ID] = contract

	// Update hash index if file hash is available
	if contract.FileHash != "" {
		// Create a composite key: tenant + hash (for multi-tenant isolation)
		hashKey := contract.Tenant + ":" + contract.FileHash
		s.hashIndex[hashKey] = contract.ID
	}

	// Cleanup if exceeds max
	s.cleanupIfNeeded()
}

func (s *ContractStore) Get(id string) *model.Contract {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.contracts[id]
}

func (s *ContractStore) GetByTenant(tenant string) []*model.Contract {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*model.Contract
	for _, c := range s.contracts {
		if c.Tenant == tenant {
			result = append(result, c)
		}
	}
	return result
}

func (s *ContractStore) Delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Remove from hash index if exists
	if contract, ok := s.contracts[id]; ok && contract.FileHash != "" {
		hashKey := contract.Tenant + ":" + contract.FileHash
		delete(s.hashIndex, hashKey)
	}

	delete(s.contracts, id)
}

func (s *ContractStore) UpdateStatus(id, status string, errMsg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if c, ok := s.contracts[id]; ok {
		c.Status = status
		c.ErrorMsg = errMsg
		c.UpdatedAt = time.Now()
	}
}

func (s *ContractStore) UpdateJSONData(id string, jsonData any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if c, ok := s.contracts[id]; ok {
		c.JSONData = jsonData
		c.Status = model.StatusCompleted
		c.UpdatedAt = time.Now()
	}
}

// cleanupIfNeeded removes oldest contracts if store exceeds maxContracts
// Must be called with lock held
func (s *ContractStore) cleanupIfNeeded() {
	if s.maxContracts <= 0 {
		return // Unlimited
	}

	if len(s.contracts) <= s.maxContracts {
		return
	}

	// Sort contracts by creation time
	contracts := make([]*model.Contract, 0, len(s.contracts))
	for _, c := range s.contracts {
		contracts = append(contracts, c)
	}
	sort.Slice(contracts, func(i, j int) bool {
		return contracts[i].CreatedAt.Before(contracts[j].CreatedAt)
	})

	// Remove oldest contracts
	removeCount := len(contracts) - s.maxContracts
	for i := 0; i < removeCount; i++ {
		slog.Info("auto-cleaning old contract",
			"contract_id", contracts[i].ID,
			"created_at", contracts[i].CreatedAt,
		)
		delete(s.contracts, contracts[i].ID)
	}
}

// Count returns the number of contracts in the store
func (s *ContractStore) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.contracts)
}

// FindByHash finds an existing contract by file hash within the same tenant
// Returns nil if not found
func (s *ContractStore) FindByHash(tenant, fileHash string) *model.Contract {
	s.mu.RLock()
	defer s.mu.RUnlock()

	hashKey := tenant + ":" + fileHash
	if contractID, ok := s.hashIndex[hashKey]; ok {
		return s.contracts[contractID]
	}
	return nil
}

// IncrementDuplicateCount increments the duplicate count for a contract
func (s *ContractStore) IncrementDuplicateCount(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if contract, ok := s.contracts[id]; ok {
		contract.DuplicateCount++
		contract.UpdatedAt = time.Now()
	}
}
