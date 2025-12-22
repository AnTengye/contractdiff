# ContractDiff

合同对比工具 - 一个用于智能对比 PDF 和 DOCX 合同文档差异的 Web 应用。

## 功能特性

- 📄 支持 PDF 和 DOCX 格式的合同文档上传
- 🔍 使用 MinerU API 进行智能文档解析和提取
- 💾 使用 MinIO 作为对象存储服务
- 🔐 JWT 认证和多租户支持
- 📊 实时处理状态跟踪
- 🖥️ 现代化 Web 界面

## 技术栈

- **后端**: Go + Gin
- **前端**: HTML + CSS + JavaScript
- **存储**: MinIO
- **文档解析**: MinerU API
- **认证**: JWT

## 快速开始

### 环境要求

- Go 1.25+
- Docker (可选)
- MinIO 服务
- MinerU API Token

### 配置

1. 复制配置模板:

```bash
cp backend/config.example.yaml backend/config.yaml
```

2. 编辑 `backend/config.yaml` 配置文件:

```yaml
server:
  port: 8080
  
minio:
  endpoint: "your-minio-endpoint"
  access_key: "your-access-key"
  secret_key: "your-secret-key"
  bucket: "pdfdiff"
  use_ssl: true
  expire_days: 7
  
mineru:
  api_url: "https://mineru.net/api/v4"
  api_token: "your-api-token"
  model_version: "vlm"
  
auth:
  jwt_secret: "your-jwt-secret"
  token_expire_hours: 24
  
users:
  - username: "admin"
    password: "admin123"
    tenant: "default"
```

### 本地运行

```bash
cd backend
go mod download
go run main.go
```

访问 http://localhost:8080 使用应用。

### Docker 部署

使用 Docker Compose:

```bash
docker-compose up -d
```

或者手动构建:

```bash
docker build -t contractdiff .
docker run -p 8080:8080 -v ./backend/config.yaml:/app/config.yaml contractdiff
```

## API 接口

| 路径 | 方法 | 描述 | 认证 |
|------|------|------|------|
| `/api/auth/login` | POST | 用户登录 | 否 |
| `/api/auth/me` | GET | 获取当前用户信息 | 是 |
| `/api/contracts/upload` | POST | 上传合同文件 | 是 |
| `/api/contracts` | GET | 获取合同列表 | 是 |
| `/api/contracts/:id` | GET | 获取单个合同详情 | 是 |
| `/api/contracts/:id/status` | GET | 获取合同处理状态 | 是 |
| `/api/contracts/:id` | DELETE | 删除合同 | 是 |

## 项目结构

```
contractdiff/
├── backend/
│   ├── config/        # 配置管理
│   ├── handler/       # HTTP 处理器
│   ├── middleware/    # 中间件（认证等）
│   ├── model/         # 数据模型
│   ├── service/       # 业务服务
│   ├── main.go        # 入口文件
│   └── config.yaml    # 配置文件
├── index.html         # 主页面
├── login.html         # 登录页面
├── app.js             # 前端逻辑
├── styles.css         # 样式表
├── Dockerfile         # Docker 配置
├── docker-compose.yml # Docker Compose 配置
└── Makefile           # 构建脚本
```

## 许可证

MIT License
