# 文本视图不完整问题分析

## 问题原因

根据日志：
```
[Parser] Using normalized format, paragraphs count: 57
[Parser] Extracted 46 blocks from paragraphs
```

**后端返回了57个段落，但前端只提取了46个块。丢失了11个段落！**

这是因为 `extractBlockText(para)` 返回空字符串时被跳过了：

```typescript
for (const para of data.paragraphs) {
  const text = extractBlockText(para);
  if (!text) continue;  // ⚠️ 这里跳过了空文本的段落
  blocks.push({...});
}
```

## 根本问题

**当前实现的问题**：
1. ❌ 跳过了没有文本的段落（可能是表格、图片等）
2. ❌ `if (!text) continue` 导致段落丢失
3. ❌ 前端解析逻辑过滤掉了部分内容

## 解决方案

我需要：
1. **保留所有段落**，即使文本为空
2. **显示段落类型**（text、table、image等）
3. **确保原文完整展示**

## 修复步骤

### 1. 修改解析器，不跳过任何段落

```typescript
for (const para of data.paragraphs) {
  const text = extractBlockText(para);
  // 不再跳过空文本，保留所有段落
  blocks.push({
    index: para.index || blocks.length,
    text: text.trim() || `[${para.type || 'empty'}]`, // 空文本显示类型
    pageIdx: (para.page || 1) - 1,
    type: para.type,
    bbox: para.bbox || [0, 0, 0, 0],
    pageSize: [612, 792],
    lines: extractLines(para),
    raw: para,
  });
}
```

### 2. 在文本视图中显示所有内容

包括表格、图片等非文本元素的占位符。

让我现在修复这个问题...
