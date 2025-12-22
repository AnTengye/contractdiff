package handler

import (
	"encoding/json"
	"net/http"

	"github.com/AnTengye/contractdiff/backend/model"
	"github.com/AnTengye/contractdiff/backend/service"
	"github.com/gin-gonic/gin"
)

type CallbackHandler struct {
	mineruService *service.MineruService
	store         *service.ContractStore
}

func NewCallbackHandler(mineruSvc *service.MineruService) *CallbackHandler {
	return &CallbackHandler{
		mineruService: mineruSvc,
		store:         service.GetContractStore(),
	}
}

type CallbackRequest struct {
	Checksum string `json:"checksum"`
	Content  string `json:"content"`
}

type CallbackContent struct {
	TaskID    string `json:"task_id"`
	DataID    string `json:"data_id"`
	State     string `json:"state"`
	FullPages []struct {
		PageNo  int    `json:"page_no"`
		MDURL   string `json:"md_url"`
		JsonURL string `json:"json_url"`
	} `json:"full_pages"`
	ErrorMsg string `json:"err_msg"`
}

// HandleCallback receives callback from MinerU
func (h *CallbackHandler) HandleCallback(c *gin.Context) {
	var req CallbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Parse content
	var content CallbackContent
	if err := json.Unmarshal([]byte(req.Content), &content); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid content format"})
		return
	}

	// Find contract by DataID (which is our contractID)
	contract := h.store.Get(content.DataID)
	if contract == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Contract not found"})
		return
	}

	// Update contract based on callback
	switch content.State {
	case "done":
		if len(content.FullPages) > 0 && content.FullPages[0].JsonURL != "" {
			jsonData, err := h.mineruService.FetchJSONResult(content.FullPages[0].JsonURL)
			if err != nil {
				h.store.UpdateStatus(contract.ID, model.StatusFailed, "Failed to fetch JSON: "+err.Error())
			} else {
				h.store.UpdateJSONData(contract.ID, jsonData)
			}
		} else {
			h.store.UpdateStatus(contract.ID, model.StatusCompleted, "")
		}
	case "failed":
		h.store.UpdateStatus(contract.ID, model.StatusFailed, content.ErrorMsg)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Callback received"})
}
