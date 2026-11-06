package service

import (
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/AnTengye/contractdiff/backend/model"
)

const defaultCacheTTL = 24 * time.Hour

// ContractStore is an in-memory store for contracts
// In production, this should be replaced with a database
type ContractStore struct {
	contracts    map[string]*model.Contract
	hashIndex    map[string]string // hash -> contract ID mapping for deduplication
	parserIndex  map[string]string
	mu           sync.RWMutex
	maxContracts int           // Maximum contracts to keep, 0 = unlimited
	cacheTTL     time.Duration // Cache TTL for deduplication
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
		cacheTTL := time.Duration(cfg.CacheTTLHours) * time.Hour
		if cacheTTL <= 0 {
			cacheTTL = defaultCacheTTL
		}
		globalStore = &ContractStore{
			contracts:    make(map[string]*model.Contract),
			hashIndex:    make(map[string]string),
			maxContracts: maxContracts,
			cacheTTL:     cacheTTL,
		}
		slog.Info("contract store initialized", "max_contracts", maxContracts, "cache_ttl_hours", int(cacheTTL.Hours()))
	})
}

// GetContractStore returns the global contract store
func GetContractStore() *ContractStore {
	if globalStore == nil {
		// Fallback initialization with default settings
		globalStore = &ContractStore{
			contracts:    make(map[string]*model.Contract),
			hashIndex:    make(map[string]string),
			maxContracts: 100,
			cacheTTL:     defaultCacheTTL,
		}
	}
	return globalStore
}

func (s *ContractStore) Save(contract *model.Contract) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.saveLocked(contract)
}

// SaveIfNotTerminal publishes a worker snapshot only while the stored record
// is still non-terminal. This prevents a late callback or another worker from
// being overwritten by a stale caller-owned contract object.
func (s *ContractStore) SaveIfNotTerminal(contract *model.Contract) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if current, ok := s.contracts[contract.ID]; ok &&
		(current.Status == model.StatusCompleted || current.Status == model.StatusFailed) {
		return false
	}
	s.saveLocked(contract)
	return true
}

func (s *ContractStore) saveLocked(contract *model.Contract) {

	contract.UpdatedAt = time.Now()
	s.contracts[contract.ID] = cloneContract(contract)
	if s.hashIndex == nil {
		s.hashIndex = make(map[string]string)
	}
	if s.parserIndex == nil {
		s.parserIndex = make(map[string]string)
	}
	if contract.FileHash != "" && !contract.IsDuplicate {
		if signature := contractIndexSignature(contract); signature != "" {
			s.parserIndex[contract.Tenant+":"+contract.FileHash+":"+signature] = contract.ID
		}
	}

	// Update hash index if file hash is available
	// Only update hashIndex for non-duplicate contracts to ensure
	// the index always points to the original contract
	if contract.FileHash != "" && !contract.IsDuplicate {
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
	return cloneContract(s.contracts[id])
}

func (s *ContractStore) GetByTenant(tenant string) []*model.Contract {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*model.Contract
	for _, c := range s.contracts {
		if c.Tenant == tenant {
			result = append(result, cloneContract(c))
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
		if s.hashIndex[hashKey] == id {
			delete(s.hashIndex, hashKey)
		}
		for key, owner := range s.parserIndex {
			if owner == id {
				delete(s.parserIndex, key)
			}
		}
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

func (s *ContractStore) UpdateFailure(id, stage, errMsg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if c, ok := s.contracts[id]; ok {
		if c.Status == model.StatusCompleted || c.Status == model.StatusFailed {
			return
		}
		c.Status = model.StatusFailed
		c.FailureStage = stage
		c.ErrorMsg = errMsg
		c.UpdatedAt = time.Now()
	}
}

// UpdateStatusIfNotTerminal updates a status while holding the same lock used
// by Save. Late parser callbacks must not move a completed or failed contract
// back into an in-progress state.
func (s *ContractStore) UpdateStatusIfNotTerminal(id, status, errMsg string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if c, ok := s.contracts[id]; ok {
		if c.Status == model.StatusCompleted || c.Status == model.StatusFailed {
			return false
		}
		c.Status = status
		c.ErrorMsg = errMsg
		c.UpdatedAt = time.Now()
		return true
	}
	return false
}

// UpdateTaskID changes parser bookkeeping without replacing the rest of the
// stored contract with a stale caller-owned copy.
func (s *ContractStore) UpdateTaskID(id, taskID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if c, ok := s.contracts[id]; ok {
		c.TaskID = taskID
		c.MineruTaskID = taskID
		c.UpdatedAt = time.Now()
		return true
	}
	return false
}

func (s *ContractStore) UpdateJSONData(id string, jsonData any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if c, ok := s.contracts[id]; ok {
		c.JSONData = cloneJSONValue(jsonData)
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
		for key, owner := range s.hashIndex {
			if owner == contracts[i].ID {
				delete(s.hashIndex, key)
			}
		}
		for key, owner := range s.parserIndex {
			if owner == contracts[i].ID {
				delete(s.parserIndex, key)
			}
		}
	}
}

// Count returns the number of contracts in the store
func (s *ContractStore) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.contracts)
}

// FindByHash finds an existing contract by file hash within the same tenant
// Returns nil if not found or if the cache has expired
func (s *ContractStore) FindByHash(tenant, fileHash string) *model.Contract {
	s.mu.RLock()
	defer s.mu.RUnlock()

	hashKey := tenant + ":" + fileHash
	if contractID, ok := s.hashIndex[hashKey]; ok {
		contract := s.contracts[contractID]
		if contract != nil && s.isCacheValid(contract) {
			return cloneContract(contract)
		}
	}
	return nil
}

// FindParsed cannot reuse a different parser/configuration or an unfinished result.
func (s *ContractStore) FindParsed(tenant, fileHash, signature string) *model.Contract {
	s.mu.RLock()
	defer s.mu.RUnlock()
	c := s.contracts[s.parserIndex[tenant+":"+fileHash+":"+signature]]
	if c != nil && c.Status == model.StatusCompleted && c.JSONData != nil && s.isCacheValid(c) {
		return cloneContract(c)
	}
	return nil
}

// FindParsedPipeline looks up only records created by the current input
// pipeline. Records without a processing signature are intentionally not
// eligible, which forces old DOCX results through conversion and parsing again.
func (s *ContractStore) FindParsedPipeline(tenant, fileHash, processingSignature string) *model.Contract {
	s.mu.RLock()
	defer s.mu.RUnlock()
	c := s.contracts[s.parserIndex[tenant+":"+fileHash+":"+processingSignature]]
	if c != nil && c.ProcessingSignature == processingSignature &&
		c.Status == model.StatusCompleted && c.JSONData != nil && s.isCacheValid(c) {
		return cloneContract(c)
	}
	return nil
}

// Result maps are immutable after publication; mutable metadata and contract
// fields are copied so asynchronous processing cannot race with API readers.
func cloneContract(c *model.Contract) *model.Contract {
	if c == nil {
		return nil
	}
	copy := *c
	if c.Metadata != nil {
		metadata := *c.Metadata
		if c.Metadata.Steps != nil {
			metadata.Steps = map[string]int64{}
			for k, v := range c.Metadata.Steps {
				metadata.Steps[k] = v
			}
		}
		if c.Metadata.PDFPages != nil {
			metadata.PDFPages = append([]model.PDFPageMetadata(nil), c.Metadata.PDFPages...)
		}
		copy.Metadata = &metadata
	}
	if c.CoordinateWarnings != nil {
		copy.CoordinateWarnings = append([]string(nil), c.CoordinateWarnings...)
	}
	copy.ParserSettings, _ = cloneJSONValue(c.ParserSettings).(map[string]interface{})
	copy.JSONData = cloneJSONValue(c.JSONData)
	copy.RawJSONData = cloneJSONValue(c.RawJSONData)
	return &copy
}

func contractIndexSignature(c *model.Contract) string {
	if c.ProcessingSignature != "" {
		return c.ProcessingSignature
	}
	return c.ParserSignature
}

// cloneJSONValue recursively copies values produced by encoding/json. The
// contract store publishes these values to concurrent API and feedback
// readers, so copying only the top-level map is not sufficient.
func cloneJSONValue(value any) any {
	switch v := value.(type) {
	case nil:
		return nil
	case map[string]interface{}:
		copy := make(map[string]interface{}, len(v))
		for key, item := range v {
			copy[key] = cloneJSONValue(item)
		}
		return copy
	case []interface{}:
		copy := make([]interface{}, len(v))
		for i, item := range v {
			copy[i] = cloneJSONValue(item)
		}
		return copy
	case map[string]string:
		copy := make(map[string]string, len(v))
		for key, item := range v {
			copy[key] = item
		}
		return copy
	case []string:
		return append([]string(nil), v...)
	case []float64:
		return append([]float64(nil), v...)
	case []int:
		return append([]int(nil), v...)
	default:
		return value
	}
}

// isCacheValid checks if a contract's cache is still valid based on TTL
func (s *ContractStore) isCacheValid(contract *model.Contract) bool {
	if s.cacheTTL <= 0 {
		return true
	}
	return time.Since(contract.CreatedAt) < s.cacheTTL
}

// InvalidateCache removes a contract from the hash index to force reprocessing
func (s *ContractStore) InvalidateCache(tenant, fileHash string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	hashKey := tenant + ":" + fileHash
	delete(s.hashIndex, hashKey)
	for key := range s.parserIndex {
		if strings.HasPrefix(key, hashKey+":") {
			delete(s.parserIndex, key)
		}
	}
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
