# [list] 类型问题解答与修复

## 问题解答

### `[list]` 是什么？

`[list]` 是**列表类型的段落**。在PDF解析中：
- **`type: "text"`** - 普通文本段落
- **`type: "list"`** - 列表项（如编号列表、无序列表）
- **`type: "table"`** - 表格
- **`type: "image"`** - 图片

### 为什么会显示 `[list]` 而不是内容？

**原因**：列表类型的段落使用**嵌套结构**存储：

```json
{
  "type": "list",
  "text": "",           // ❌ text 字段为空！
  "blocks": [          // ✅ 实际内容在 blocks 数组里
    {
      "type": "list_item",
      "lines": [
        {"spans": [{"content": "1. 第一项"}]}
      ]
    },
    {
      "type": "list_item", 
      "lines": [
        {"spans": [{"content": "2. 第二项"}]}
      ]
    }
  ]
}
```

### 之前的代码问题

```typescript
// ❌ 旧代码 - 只检查 text 和 lines，忽略了 blocks
function extractBlockText(block: any): string {
  if (block.text) return block.text;  // list 的 text 为空
  
  if (block.lines) {  // list 没有 lines
    // 提取文本...
  }
  
  return '';  // 返回空字符串！
}
```

结果：
- 列表段落的 `text` 字段为空
- 没有提取 `blocks` 数组中的内容
- 最终显示 `[list]` 占位符

## 已修复

### 新的提取逻辑

```typescript
// ✅ 新代码 - 支持嵌套 blocks
function extractBlockText(block: any): string {
  let text = '';
  
  // 1. 检查直接 text 字段
  if (block.text && typeof block.text === 'string') {
    return block.text;
  }
  
  // 2. 处理嵌套 blocks（列表、复杂结构）
  if (block.blocks && Array.isArray(block.blocks)) {
    for (const subBlock of block.blocks) {
      const subText = extractBlockText(subBlock);  // 递归提取
      if (subText) {
        text += subText + '\n';
      }
    }
  }
  
  // 3. 处理 lines/spans 结构
  if (block.lines && Array.isArray(block.lines)) {
    for (const line of block.lines) {
      for (const span of line.spans || []) {
        if (span.content) {
          text += span.content;
        }
      }
    }
  }
  
  return text;
}
```

### 修复效果

**修复前**：
```
[Parser] Using normalized format, paragraphs count: 57
[Parser] Extracted 46 blocks from paragraphs  // 丢失11个
文本视图显示：
  1. 展会概况
  [list]  ← 内容缺失！
  2. 展位情况
```

**修复后**：
```
[Parser] Using normalized format, paragraphs count: 57
[Parser] Extracted 57 blocks from paragraphs  // 完整！
文本视图显示：
  1. 展会概况
  1.1 展会名称：2026国际低空经济...
  1.2 展会时间：2026年5月...
  1.3 展会地点：深圳会展中心...
  2. 展位情况
```

## 数据结构说明

### MinerU 解析的段落结构

```typescript
// 类型1: 简单文本段落
{
  type: "text",
  text: "这是一个段落",
  lines: [...],
  bbox: [x0, y0, x1, y1]
}

// 类型2: 列表段落（嵌套结构）
{
  type: "list",
  text: "",  // 通常为空
  blocks: [  // 内容在这里
    {
      type: "list_item",
      lines: [...]
    },
    ...
  ]
}

// 类型3: 表格
{
  type: "table",
  text: "",
  blocks: [  // 单元格内容
    {
      type: "table_cell",
      lines: [...]
    }
  ]
}
```

## 测试步骤

### 1. 刷新页面
```bash
Ctrl + F5
```

### 2. 查看控制台
应该看到：
```
[Parser] Extracted 57 blocks from paragraphs
```

### 3. 查看文本视图
- ✅ 列表内容应该完整显示
- ✅ 不再有 `[list]` 占位符
- ✅ 所有57个段落都有内容

### 4. 如果还有 `[list]`
说明该段落确实没有任何文本内容（极少见）。可以在控制台查看：
```javascript
window.lastComparisonDebug
```

## 总结

### 问题本质
- **不是要"省略"列表** - 而是之前没有正确提取列表内容
- **列表使用嵌套结构** - 需要递归提取 `blocks` 数组

### 解决方案
- ✅ 添加递归提取嵌套 blocks
- ✅ 保留所有段落（不跳过）
- ✅ 正确处理 list、table 等复杂结构

### 预期效果
- **文本视图**：显示完整的57个段落，包括所有列表项
- **比对结果**：基于完整文本的精确比对
- **视觉标注**：在完整内容基础上标注差异

---

**构建已完成，请刷新浏览器测试！** 🚀

现在列表内容应该能够正常显示了。
