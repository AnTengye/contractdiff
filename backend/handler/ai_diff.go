package handler

import (
	"encoding/json"
	"net/http"

	"github.com/AnTengye/contractdiff/backend/middleware"
	"github.com/AnTengye/contractdiff/backend/model"
	"github.com/AnTengye/contractdiff/backend/service"
	"github.com/AnTengye/contractdiff/backend/service/aidiff"
	"github.com/gin-gonic/gin"
)

type AIDiffHandler struct {
	ai        *aidiff.Service
	contracts *service.ContractStore
}

func NewAIDiffHandler(ai *aidiff.Service, contracts *service.ContractStore) *AIDiffHandler {
	return &AIDiffHandler{ai, contracts}
}

func aiOwner(c *gin.Context) string {
	owner, _ := json.Marshal([]string{middleware.GetTenant(c), middleware.GetUsername(c)})
	return string(owner)
}

func (h *AIDiffHandler) Create(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	var request struct {
		LeftID     string         `json:"left_id"`
		RightID    string         `json:"right_id"`
		Options    aidiff.Options `json:"options"`
		Candidates []aidiff.Hint  `json:"candidates"`
	}
	request.Options.IgnoreWhitespace = true
	if c.ShouldBindJSON(&request) != nil || request.LeftID == "" || request.RightID == "" || len(request.Candidates) > 500 {
		c.JSON(400, gin.H{"error": "AI 比对请求无效，算法结果仍可使用"})
		return
	}
	left, right := h.contracts.Get(request.LeftID), h.contracts.Get(request.RightID)
	for _, doc := range []*model.Contract{left, right} {
		if doc == nil || doc.Tenant != middleware.GetTenant(c) {
			c.JSON(404, gin.H{"error": "文档不存在"})
			return
		}
		if doc.Status != model.StatusCompleted || doc.JSONData == nil {
			c.JSON(409, gin.H{"error": "文档解析尚未完成"})
			return
		}
		if doc.PDFHash == "" || doc.ResultSignature == "" {
			c.JSON(409, gin.H{"error": "旧文档缺少原件绑定信息，请重新上传；算法结果仍可使用"})
			return
		}
	}
	if !h.ai.Available() {
		c.JSON(503, gin.H{"error": "AI 服务未配置，算法结果仍可使用"})
		return
	}
	job, err := h.ai.Start(aiOwner(c), left, right, request.Options, request.Candidates)
	if err != nil {
		status := 422
		if err == aidiff.ErrBusy {
			status = 429
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, job)
}

func (h *AIDiffHandler) Get(c *gin.Context) {
	job, ok := h.ai.Get(aiOwner(c), c.Param("id"))
	if !ok {
		c.JSON(404, gin.H{"error": "AI 任务已过期，请重新比对；算法结果仍可使用"})
		return
	}
	c.JSON(200, job)
}

func (h *AIDiffHandler) Visual(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 9<<20)
	var images aidiff.VisualRequest
	if c.ShouldBindJSON(&images) != nil {
		c.JSON(400, gin.H{"error": "页面图像无效"})
		return
	}
	job, err := h.ai.StartVisual(aiOwner(c), c.Param("id"), images)
	if err != nil {
		status := 422
		if err == aidiff.ErrBusy {
			status = 429
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, job)
}
