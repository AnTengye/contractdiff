# # 文件比对的设计方案
用户需要上传两份文件，一份为原件，一份为修改件。

工具需要将文件解析并将两份文件的差异展示出来以方便用户了解有哪些区别。


## 转换
- 用户上传的文件一般为pdf或者docx。

- 大部分文档识别或OCR解析软件都只支持pdf或者img。

- 因此为了满足标准化，需要将用户上传的文件转换为pdf或者img。

目前调研发现，有以下几种方案：
### MinerU
详细信息见官网：https://opendatalab.github.io/MinerU/zh/reference/output_files/

本身就支持pdf/docx/img等格式。转换后会生成一个zip文件，里面包含了详细的解析后数据如：

模型输出(使用原始输出):

model.json
调试和验证(使用可视化文件):

layout.pdf
spans.pdf
内容提取(使用简化文件):

*.md
content_list.json
二次开发(使用结构化文件):

middle.json

### PaddleOCR
仅支持pdf/img格式。

### gotenberg
支持将docx转换为pdf。详细信息见官网：https://gotenberg.dev/docs/getting-started/introduction

## 比对

在前面的转换逻辑处理完之后，理论上标准的输出应该会包含，一个pdf原件（或转换后的pdf）和一个json数据。

比对主要分为两个部分
1. json数据包含了详细的坐标和具体的文本，因此是比较差异的核心，需要确保差异比对时能够详细将两份文件的差异全部列举出来。

2. pdf原件（或转换后的pdf）是展示差异的载体，因为用户需要直观的看到自己的文件在什么地方存在差异性，所以需要结合json对比的结果来将结果回显到pdf上。

## 已实现的第一、第二期

默认保留小数点、百分号、正负号等合同关键符号。空白、普通标点、页眉页脚的忽略规则由界面显式选择。先按唯一文本、条款编号和表格位置对齐，再在匹配段落/单元格内进行字符比对；支持内容不变且可唯一识别的条款移动，以及跨页拆段。统计单位是变更段落或单元格，左右两侧、文本视图、PDF 高亮和反馈共用差异编号。

表格保留单元格及 rowspan/colspan。保留真实页尺寸、行、字符或单元格坐标；模型只有整块 bbox 时显示区域定位，不推算字符框。没有可比较内容或计算达到上限时明确显示未完成，不能当作无差异。浏览器 Worker 计算支持取消和替换文档后失效；PDF 仅渲染附近页面，每侧缓存目标为 8 页，优先保留当前可见页，缩放时只重绘可视范围。

解析结果缓存由租户、文件哈希、解析器、服务地址、解析选项、声明模型修订和标准化版本共同确定，仅复用完成结果。模型真实权重版本无法从云端确认时记录为 unknown。服务同一地址更新模型后，可在对应解析器配置增加 `model_revision`（例如内部部署修订号）或强制重新解析；该字段用于缓存身份，不会发送给上游，也不代表已验证的模型权重版本。普通文档详情默认不返回大体积原始解析，诊断可加 `?include_raw=true`；反馈归档由后端直接读取原始结果。PaddleOCR 同步调用完成后立即读取结果，不再额外等待首个 5 秒轮询；完成结果的序列化缓存读取后释放。后台每个进程最多同时解析 4 份文档。

### 反馈与分析

“反馈问题”、每条差异旁的“反馈”、PDF 高亮双击和“框选问题区域”均可提交。漏报可以在原件上选择页码或框选区域，不要求已有差异。解析失败后的任务也可反馈。

SQLite 保存反馈、处理历史及并发修订号；MinIO 的 `feedback/<tenant>/<case_id>/` 保存原件/展示 PDF 副本和不可变复现快照，包含原始解析、标准化数据、比对规则、算法版本/前端构建指纹、文件哈希、请求/任务 ID 和耗时。快照会移除认证字段和 URL 签名。下载附件通过鉴权接口流式返回，不保存临时签名链接。源文档记录清理、应用重启不会清理已归档案例；反馈目前长期保留，应按组织资料保留制度管理 SQLite 和 MinIO 备份，并避免给反馈前缀配置提前到期的对象生命周期。

配置（既有用户账号名，不创建或修改账号）：

```yaml
feedback:
  db_path: "data/feedback.db"
  reviewers: [] # 填入可分析反馈的现有用户名
```

普通用户只能查看自己提交的案例；分析人员可以分析自己租户内的案例，不能跨租户读取。分析流程为“待分析 → 已复现 → 已归因 → 已修复 → 已验证”，每步填写记录，修复需填写版本，验证需至少一项回归预期。无法复现/暂不处理可关闭并记录原因。旧修订号的更新返回 409，避免覆盖他人分析。

Docker Compose 已挂载 `/app/data` 持久卷；自定义部署也必须持久挂载 `feedback.db` 所在目录。大型附件仍位于既有 MinIO。契约和解析记录本身仍是内存缓存，重启后需重新上传；反馈归档与附件独立保留。

鉴权 API：

- `POST /api/feedback`：问题类型、说明、预期、左右文档 ID、可选页码/bbox、比对上下文。
- `GET /api/feedback`、`GET /api/feedback/:id`：最近 200 条案例及分析详情。
- `PUT /api/feedback/:id`：状态、记录、修复版本、回归预期、当前 revision。
- `GET /api/feedback/:id/artifacts/:artifact`：snapshot、left/right_original、left/right_pdf。
- `GET /api/feedback/:id/regression`：已验证且有标注的案例导出，需分析权限。

### 验证与回归

```bash
cd backend
GOTENBERG_URL= go test ./...
# 并发读回、归档和缓存隔离
go test -race ./handler ./service/parser ./service -run 'Test(Feedback|ParserCache|Normalize|Normalization|MinerUNormalization|PaddleRetains|ParserIdentity|ContractStore)'
cd ../frontend
npm ci
npm run test
npm run typecheck
npm run build
```

已验证的案例可从分析界面导出。离线重新标准化后验证期望，不会调用模型或上传文档：

```bash
cd backend
go run ./cmd/replay-feedback /path/to/feedback-case.json > /tmp/normalized-case.json
cd ../frontend
npm run replay:feedback -- /tmp/normalized-case.json
```

回归预期可标注差异数、原件应包含文本、修改件应包含文本。CLI 需要案例中存在原始解析 JSON；只有任务错误而尚无解析产物的案例需先按原件另行复现。已导出案例包含合同内容，应存于有权限控制的位置。

本期不切换线上模型，也不增加图片/印章像素比对。复杂表格插行/重排、重复或同时修改并移动的条款，仍需真实合同样例评估；不具备细坐标的解析产物只能区域定位。

### 本地验收（2026-10-14）

后端完整测试及反馈、解析、缓存相关的 race 检查通过；前端 30 项回归、类型检查和构建通过。浏览器使用本地合成合同和解析产物，验证了金额/表格的 2 处修改、40 页 PDF 的按需渲染与缩放、框选源坐标归档，以及反馈状态流转、重启读回、原件下载哈希一致和离线重新标准化回归。没有调用线上 OCR、部署或切换模型。

相同输入在本地 Node 上运行新旧算法各 3 次，以下为中位耗时，仅衡量文本比对：

| 合成段落数 | 原算法 | 当前算法 |
| --- | ---: | ---: |
| 200 | 13.4 ms | 6.6 ms |
| 1000 | 298.8 ms | 29.5 ms |
| 3000 | 2573.1 ms | 84.7 ms |

这些数据不能代表生产延迟或 OCR 识别率。识别率提升需要用经过标注的真实反馈案例，分别评估文字识别、差异检出和定位效果。
