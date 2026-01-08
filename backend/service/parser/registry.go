package parser

import (
	"fmt"
	"sync"
)

// Registry manages all available document parsers
type Registry struct {
	parsers map[ParserType]DocumentParser
	mu      sync.RWMutex
}

var (
	globalRegistry *Registry
	registryOnce   sync.Once
)

// GetRegistry returns the global parser registry
func GetRegistry() *Registry {
	registryOnce.Do(func() {
		globalRegistry = &Registry{
			parsers: make(map[ParserType]DocumentParser),
		}
	})
	return globalRegistry
}

// Register adds a parser to the registry
func (r *Registry) Register(parser DocumentParser) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	caps := parser.GetCapabilities()
	if _, exists := r.parsers[caps.Type]; exists {
		return fmt.Errorf("parser %s already registered", caps.Type)
	}

	r.parsers[caps.Type] = parser
	return nil
}

// Get retrieves a parser by type
func (r *Registry) Get(parserType ParserType) (DocumentParser, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	parser, ok := r.parsers[parserType]
	if !ok {
		return nil, fmt.Errorf("parser %s not found", parserType)
	}
	return parser, nil
}

// GetAll returns all registered parsers
func (r *Registry) GetAll() []DocumentParser {
	r.mu.RLock()
	defer r.mu.RUnlock()

	parsers := make([]DocumentParser, 0, len(r.parsers))
	for _, p := range r.parsers {
		parsers = append(parsers, p)
	}
	return parsers
}

// GetCapabilities returns capabilities of all parsers
func (r *Registry) GetCapabilities() []ParserCapabilities {
	r.mu.RLock()
	defer r.mu.RUnlock()

	caps := make([]ParserCapabilities, 0, len(r.parsers))
	for _, p := range r.parsers {
		caps = append(caps, p.GetCapabilities())
	}
	return caps
}

// FindParsersForFormat returns parsers that can handle the given format
func (r *Registry) FindParsersForFormat(format string) []DocumentParser {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var parsers []DocumentParser
	for _, p := range r.parsers {
		if p.CanParse(format) {
			parsers = append(parsers, p)
		}
	}
	return parsers
}

// Count returns the number of registered parsers
func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.parsers)
}
