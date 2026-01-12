# 🎯 根本问题确认报告

## 问题定位（基于控制台日志分析）

### 关键证据

从您提供的控制台日志中，我找到了决定性证据：

```
Right Annotations:
  Page 0: 12 annotations
    added: bbox=238.0,101.0,369.0,122.0, text="面政治舆情或损害国家安全和利益的风险..."
```

**关键发现**:
- "面政治舆情..." 这段文字在 **Page 0**（第1页）的注释中
- 但您说这段内容应该在**第3页**
- Page 0 = pageIdx 0 = 第1页（因为是从0开始计数）

---

## 🔴 根本原因

### **后端 OCR 解析器返回的 `page` 字段是错误的！**

#### 证明链：

1. **前端代码** (`comparisonEngine.ts` line 47):
   ```typescript
   pageIdx: (para.page || 1) - 1
   ```
   - 如果后端 `para.page = 1`，则 `pageIdx = 0`（第1页）
   - 如果后端 `para.page = 3`，则 `pageIdx = 2`（第3页）

2. **Visual annotation 显示**:
   - "面政治舆情..." 在 `Page 0`
   - 说明 `pageIdx = 0`

3. **反推后端数据**:
   - `pageIdx = 0` → `para.page - 1 = 0` → **`para.page = 1`**

4. **结论**:
   - 后端返回的这段文字的 `page` 字段 = **1**
   - 但实际这段文字在 PDF 的**第3页**
   - **OCR 解析器把页码识别错了！**

---

## ❌ 为什么前端排序无法解决

### 前端排序逻辑：

```typescript
blocks.sort((a, b) => {
  if (a.pageIdx !== b.pageIdx) {
    return a.pageIdx - b.pageIdx;  // ← 按 pageIdx 排序
  }
  return a.index - b.index;
});
```

### 问题：

| 段落内容 | 实际页码 | 后端返回 page | 计算的 pageIdx | 排序后位置 |
|---------|---------|--------------|---------------|-----------|
| 第1页内容 | 1 | 1 | 0 | ✅ 第1位 |
| 第2页内容 | 2 | 2 | 1 | ✅ 第2位 |
| **面政治舆情...** | **3** | **1** ❌ | **0** | ❌ **第1位**（与第1页内容混在一起） |
| 第4页内容 | 4 | 4 | 3 | ✅ 第4位 |

**排序结果**:
```
pageIdx=0: 第1页内容 + "面政治舆情..."  ← 两个 pageIdx=0 的段落
pageIdx=1: 第2页内容
pageIdx=3: 第4页内容
```

**显示顺序**: 取决于 `index` 字段在 pageIdx=0 内的排序

---

## 🔍 为什么会出现混乱的显示顺序

您看到的显示顺序：**第3页 → 第2页 → 第3页**

**原因分析**:

1. **多个段落有相同的 pageIdx=0**
   - 真正的第1页内容：`pageIdx=0, index=0-10`
   - "面政治舆情..." (应该在第3页)：`pageIdx=0, index=4`

2. **按 index 排序时**:
   ```
   pageIdx=0, index=0: 第1页段落1
   pageIdx=0, index=1: 第1页段落2
   pageIdx=0, index=4: "面政治舆情..."  ← 插入到这里
   pageIdx=0, index=5: 第1页段落3
   ...
   pageIdx=1, index=X: 第2页内容
   ```

3. **页面分隔符显示**:
   - 当 `pageIdx` 变化时显示 "第 X 页"
   - 但如果多个段落 `pageIdx` 相同，只显示一次分隔符

4. **结果混乱**:
   - 第1页和"应该在第3页的内容"混在一起
   - 页面分隔符位置不对
   - 用户看到的顺序完全混乱

---

## ✅ 真正的解决方案

### 方案 A：修复后端 OCR 解析（推荐）⭐

**位置**: 后端 Go 代码 - MinerU 解析器

**问题**: MinerU 返回的 JSON 中，某些段落的 `page` 字段不正确

**需要检查**:
1. MinerU 的版本和配置
2. 是否有页面检测问题
3. 是否需要调整 OCR 参数

**修复方式**:
```go
// backend/service/parser/mineru_parser.go
// 在 NormalizeResult 函数中添加页码验证

func (p *MineruParser) NormalizeResult(rawData map[string]interface{}) (map[string]interface{}, error) {
    // ... 现有代码 ...
    
    // 添加页码验证和修正逻辑
    for _, para := range paragraphs {
        // 检查 page 字段是否合理
        // 如果 bbox 的 Y 坐标表明在页面底部，但 page=1，则可能有问题
        // 可以根据 bbox 坐标重新推断页码
    }
}
```

### 方案 B：前端根据 bbox 重新推断页码（临时方案）

**位置**: `frontend/src/services/diff/engine/comparisonEngine.ts`

**思路**: 不信任后端的 `page` 字段，根据 `bbox` 坐标重新计算页码

```typescript
// 在 parseVisualBlocks 中
blocks.push({
  index: para.index || blocks.length,
  text: displayText,
  pageIdx: inferPageFromBbox(para.bbox, para.page),  // ← 新函数
  type: para.type,
  bbox: para.bbox || [0, 0, 0, 0],
  pageSize: [612, 792],
  lines: extractLines(para),
  raw: para,
});

function inferPageFromBbox(bbox: number[], declaredPage: number): number {
  // 根据 bbox 的 Y 坐标推断页码
  // 如果 bbox[1] (Y坐标) 表明在页面顶部，使用 declaredPage
  // 如果明显超出单页范围，重新计算
  
  if (!bbox || bbox.length < 4) {
    return (declaredPage || 1) - 1;
  }
  
  const y = bbox[1];
  const pageHeight = 792;  // 标准页面高度
  
  // 简单推断：Y 坐标 / 页面高度
  const inferredPage = Math.floor(y / pageHeight);
  
  // 如果推断页码与声明页码差距过大（>1），使用推断值
  const declaredPageIdx = (declaredPage || 1) - 1;
  if (Math.abs(inferredPage - declaredPageIdx) > 1) {
    console.warn(`[Parser] Page mismatch: declared=${declaredPage}, inferred=${inferredPage + 1}, bbox=${bbox}`);
    return inferredPage;
  }
  
  return declaredPageIdx;
}
```

### 方案 C：直接使用 PDF 原始页码（如果可用）

如果后端解析时有原始 PDF 页码信息，直接使用：

```typescript
// 如果 para 对象中有 originalPage 或 pdfPage 字段
pageIdx: (para.originalPage || para.pdfPage || para.page || 1) - 1
```

---

## 📊 总结

### 问题核心

**不是前端排序的问题**，而是**后端数据的 `page` 字段本身就是错的**！

### 证据

- Visual annotation 显示 "面政治舆情..." 在 Page 0
- 但这段文字实际应该在第3页
- 说明后端返回 `page=1` 而不是 `page=3`

### 影响范围

所有 `page` 字段不正确的段落都会：
1. 被排序到错误的位置
2. 与其他页面的内容混在一起
3. 导致页面分隔符错误
4. 用户看到混乱的显示顺序

### 推荐解决方案

**短期**：实施方案 B（前端根据 bbox 推断页码）  
**长期**：修复后端 OCR 解析器（方案 A）

---

## 🔧 立即可执行的修复

我现在就可以实施**方案 B**，添加页码推断逻辑。

**是否需要我立即实施？**

或者，如果您希望我协助检查后端 MinerU 解析器配置，我也可以提供具体的检查和修复建议。

---

**修复优先级**: 🔴 Critical  
**影响用户**: ✅ 是  
**可快速修复**: ✅ 是（方案 B）  
**根本解决**: ⏳ 需要后端配合（方案 A）
