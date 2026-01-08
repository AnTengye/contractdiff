package handler

import (
	"net/http"

	"github.com/AnTengye/contractdiff/backend/service/parser"
	"github.com/gin-gonic/gin"
)

// ParserHandler handles parser-related API requests
type ParserHandler struct {
	registry *parser.Registry
}

// NewParserHandler creates a new parser handler
func NewParserHandler(registry *parser.Registry) *ParserHandler {
	return &ParserHandler{
		registry: registry,
	}
}

// ListParsers returns all available parsers and their capabilities
// GET /api/parsers
func (h *ParserHandler) ListParsers(c *gin.Context) {
	capabilities := h.registry.GetCapabilities()

	c.JSON(http.StatusOK, gin.H{
		"parsers": capabilities,
		"count":   len(capabilities),
	})
}

// GetParsersForFormat returns parsers that support a specific format
// GET /api/parsers/format?format=pdf
func (h *ParserHandler) GetParsersForFormat(c *gin.Context) {
	format := c.Query("format")
	if format == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "format parameter is required (e.g., ?format=pdf)",
		})
		return
	}

	parsers := h.registry.FindParsersForFormat(format)
	capabilities := make([]parser.ParserCapabilities, len(parsers))
	for i, p := range parsers {
		capabilities[i] = p.GetCapabilities()
	}

	c.JSON(http.StatusOK, gin.H{
		"format":  format,
		"parsers": capabilities,
		"count":   len(capabilities),
	})
}
