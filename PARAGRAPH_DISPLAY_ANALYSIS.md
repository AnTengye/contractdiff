# 段落未显示问题分析报告

## 用户报告的问题

**数据示例：**
```json
{
    "angle": 0,
    "bbox": [45, 74, 554, 106],
    "index": 4,
    "lines": [
        {
            "bbox": [45, 74, 554, 106],
            "spans": [
                {
                    "bbox": [45, 74, 554, 106],
                    "content": "面政治舆情或损害国家安全和利益的风险，甲方有权取消乙方参展资格，乙方已支付的展位费不予退还。",
                    "type": "text"
                }
            ]
        }
    ],
    "page": 3,
    "type": "text"
}
```

**问题：** 这段数据在前端没有展示出来

---

## 测试结果

### ✅ 文本提取测试 - 通过

```
输入数据结构:
- index: 4
- page: 3
- type: text
- 有 text 属性? false
- 有 lines 属性? true

开始提取文本...
  ✓ 找到 block.lines 数组，长度: 1
    ✓ 找到 line.spans 数组，长度: 1
      ✓ 找到 span.content: 面政治舆情或损害国家安全和利益的风险...

提取结果:
- 提取的文本: "面政治舆情或损害国家安全和利益的风险，甲方有权取消乙方参展资格，乙方已支付的展位费不予退还。"
- 文本长度: 46 字符
- 是否为空: false
```

**结论：** `extractBlockText()` 函数能够正确提取文本。

### ✅ 数据结构测试 - 正常

```javascript
parseVisualBlocks 创建的 VisualBlock:
{
    index: 4,
    text: "面政治舆情或损害国家安全和利益的风险，甲方有权取消乙方参展资格，乙方已支付的展位费不予退还。",
    pageIdx: 2,  // page 3 → pageIdx 2 (0-based)
    type: "text",
    bbox: [45, 74, 554, 106],
    pageSize: [612, 792],
    lines: [...],
    raw: {...}
}
```

**结论：** 数据结构转换正确，文本内容完整。

---

## 可能的原因分析

既然数据提取没有问题，段落不显示的原因可能是：

### 1. 块对齐 (Block Alignment) 问题 ⚠️

**最可能的原因：** 这个块被错误地匹配到了另一个块，导致在 diff 中被跳过。

**检查方法：**
```javascript
// 在浏览器控制台查看对齐结果
console.log(window.lastComparisonDebug);

// 或者查看块对齐警告
// 控制台应该会显示类似：
[BlockAlign] Potential missed match - Left block 4 (text_sim=0.XXX, pos_score=0.XXX with Right Y)
```

**可能情况：**
- 左右两边都有这段文字，但相似度略低于阈值 (0.5)
- 这个块被匹配到了错误的位置
- OCR 归一化后文本发生了变化

### 2. 渲染条件过滤 ⚠️

**DiffPaneV2.ts 第 92 行的跳过条件：**
```typescript
if (!block.text && !diff.hasDiff) continue;
```

**但是我们的测试显示：**
- `block.text` = "面政治舆情或损害国家安全和利益的风险..." (46 字符)
- 所以这个条件不会触发跳过

**第 104-111 行的内容检查：**
```typescript
if (!hasContentOnThisSide && diff.hasDiff) {
    // 如果这一侧没有内容，跳过
    diffIndexCounter++;
    continue;
}
```

**可能情况：**
- 如果这是一个单边的变化（只在一侧存在）
- 且在当前显示的侧没有内容
- 会被跳过

### 3. 页面过滤 ⚠️

**检查是否有页面显示限制：**
```typescript
// DiffPaneV2.ts 第 83-86 行
if (pageIdx !== lastPage && pageIdx >= 0) {
    html += `<div class="page-separator">第 ${pageIdx + 1} 页</div>`;
    lastPage = pageIdx;
}
```

- 你的数据是 `page: 3` → `pageIdx: 2`
- 应该会显示 "第 3 页" 分隔符
- 不应该被过滤

### 4. diff.hasDiff = false 但被跳过 ⚠️

**如果这个块与对侧完全匹配：**
```typescript
// 第 119-121 行
if (!diff.hasDiff) {
    // 无差异 - 显示原始文本，不加标记
    html += `<span class="unchanged">${escapeHtml(block.text)}</span>`;
}
```

**这种情况下应该显示为灰色文本（unchanged）**

---

## 诊断步骤

### 步骤 1: 检查这个块是否被加载

在浏览器控制台运行：
```javascript
// 获取左侧和右侧的所有块
const leftBlocks = window.diffStore?.getState()?.comparisonResult?.textDiff?.diffs.map(d => d.leftBlock);
const rightBlocks = window.diffStore?.getState()?.comparisonResult?.textDiff?.diffs.map(d => d.rightBlock);

// 查找包含这段文字的块
const searchText = "面政治舆情或损害国家安全和利益的风险";
const leftMatch = leftBlocks?.filter(b => b.text?.includes(searchText));
const rightMatch = rightBlocks?.filter(b => b.text?.includes(searchText));

console.log("左侧找到的块:", leftMatch);
console.log("右侧找到的块:", rightMatch);
```

### 步骤 2: 检查块对齐情况

```javascript
// 查看所有对齐
const alignments = window.diffStore?.getState()?.comparisonResult?.textDiff?.alignments;

// 查找 index=4 的块的对齐情况
const block4Alignment = alignments?.find(a => a.leftIndex === 4 || a.rightIndex === 4);

console.log("块 4 的对齐:", block4Alignment);
```

### 步骤 3: 检查 diff 数据

```javascript
// 获取所有 diffs
const diffs = window.diffStore?.getState()?.comparisonResult?.textDiff?.diffs;

// 查找包含这段文字的 diff
const targetDiff = diffs?.find(d => 
    d.leftBlock.text?.includes(searchText) || 
    d.rightBlock.text?.includes(searchText)
);

console.log("目标 diff:", targetDiff);
console.log("hasDiff:", targetDiff?.hasDiff);
console.log("similarity:", targetDiff?.similarity);
console.log("diffs 操作:", targetDiff?.diffs);
```

### 步骤 4: 检查 DOM 渲染

```javascript
// 检查 DOM 中是否有这段文字
const leftPane = document.querySelector('.diff-pane.left-pane .diff-content');
const rightPane = document.querySelector('.diff-pane.right-pane .diff-content');

console.log("左侧 HTML 包含此文字?", leftPane?.innerHTML.includes(searchText));
console.log("右侧 HTML 包含此文字?", rightPane?.innerHTML.includes(searchText));

// 查找包含此文字的段落
const allParas = document.querySelectorAll('.diff-para');
const matchingParas = Array.from(allParas).filter(p => p.textContent.includes(searchText));
console.log("包含此文字的段落数量:", matchingParas.length);
console.log("段落元素:", matchingParas);
```

---

## 可能的解决方案

### 方案 1: 降低相似度阈值（如果是对齐问题）

如果控制台显示类似警告：
```
[BlockAlign] Potential missed match - Left block 4 (text_sim=0.48, pos_score=0.95 with Right 5)
```

**说明：** 文本相似度 0.48 < 0.5 阈值，虽然位置很接近

**解决：** 在 `comparisonV2.ts` 中调整阈值
```typescript
const result = runComparisonEngine(leftData, rightData, {
    enableOCRNormalization: true,
    usePositionScoring: true,
    similarityThreshold: 0.4,  // 降低到 0.4
});
```

### 方案 2: 检查 OCR 归一化是否过度

如果 OCR 归一化导致文本差异太大：

**临时禁用 OCR 归一化测试：**
```typescript
const result = runComparisonEngine(leftData, rightData, {
    enableOCRNormalization: false,  // 临时禁用
    usePositionScoring: true,
});
```

### 方案 3: 调整渲染逻辑（如果是显示过滤问题）

**修改 DiffPaneV2.ts 第 104-111 行：**
```typescript
// 添加调试日志
if (!hasContentOnThisSide && diff.hasDiff) {
    console.warn('[DiffPane] 跳过块:', {
        side: this.side,
        blockIndex: i,
        blockText: block.text?.substring(0, 50),
        reason: '当前侧无内容'
    });
    diffIndexCounter++;
    continue;
}
```

---

## 立即行动建议

### 请你做以下检查：

1. **打开浏览器控制台**（F12）

2. **运行步骤 1-4 的诊断命令**

3. **截图并提供以下信息：**
   - 步骤 1: 左右侧找到的块
   - 步骤 2: 块的对齐情况
   - 步骤 3: diff 数据
   - 步骤 4: DOM 渲染结果

4. **检查控制台警告：**
   - 是否有 `[BlockAlign] Potential missed match` 警告？
   - 是否有其他错误信息？

5. **检查这段文字在哪一侧：**
   - 只在左侧（合同 1）？
   - 只在右侧（合同 2）？
   - 两侧都有？

### 我可以帮你：

根据你提供的诊断结果，我可以：
- 调整相似度阈值
- 修改对齐算法
- 优化渲染逻辑
- 修复特定的显示问题

---

## 测试文件已创建

我已经创建了一个测试页面：`test-data-extraction.html`

你可以：
1. 在浏览器中打开这个文件
2. 会自动测试你提供的数据
3. 显示提取结果和可能的问题

---

**总结：** 

根据测试，**数据提取功能正常**。问题很可能出在：
1. ⚠️ **块对齐阶段** - 可能被错误匹配或未匹配
2. ⚠️ **渲染过滤** - 可能被某个条件跳过显示
3. ⚠️ **前端状态** - 可能根本没有加载到这个块

请运行上述诊断命令，告诉我结果，我会帮你精确定位问题！
