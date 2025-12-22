package service

import (
	"sync"
	"time"

	"github.com/AnTengye/contractdiff/backend/model"
)

// ContractStore is an in-memory store for contracts
// In production, this should be replaced with a database
type ContractStore struct {
	contracts map[string]*model.Contract
	mu        sync.RWMutex
}

var globalStore = &ContractStore{
	contracts: make(map[string]*model.Contract),
}

func GetContractStore() *ContractStore {
	return globalStore
}

func (s *ContractStore) Save(contract *model.Contract) {
	s.mu.Lock()
	defer s.mu.Unlock()
	contract.UpdatedAt = time.Now()
	s.contracts[contract.ID] = contract
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
