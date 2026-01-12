# 🔴 关键问题：排序修复未生效

## 问题现状

### 用户报告
从最新截图看到，右侧显示顺序仍然是乱的：
```
第3页 → 第2页 → 第3页
```

这说明**我们的排序修复根本没有生效**，或者被某个环节打乱了。

## 可能的原因

### 原因 1: 浏览器缓存未清除 ⚠️
**最可能！**

即使我们重新构建了代码，如果浏览器缓存了旧版本的 JavaScript，排序逻辑仍然是旧的。

**验证方法**:
```javascript
// 在浏览器控制台运行
console.log('[BlockAlign] Sorted alignments by page and index order');
```

**如果没有看到这条日志，说明浏览器使用的是旧代码！**

### 原因 2: 后端数据本身就是乱序的 ⚠️
**很可能！**

后端返回的 `paragraphs` 数组本身就不是按 `page` 字段排序的。

**例如**:
```json
paragraphs: [
  { page: 3, index: 10, text: "..." },  // 第3页
  { page: 2, index: 5, text: "..." },   // 第2页
  { page: 4, index: 15, text: "..." },  // 第4页
]
```

如果后端数据是这个顺序，那么：
1. `parseVisualBlocks` 会按数组顺序创建块
2. `blockAlignment` 会按块数组索引对齐
3. 即使排序了对齐结果，blocks 数组本身还是乱的

**关键问题**: 我们的排序只排序了 `alignments` 数组，但 `diffs` 数组的顺序取决于 `alignments` 的索引！

### 原因 3: parseVisualBlocks 没有排序 ⚠️
**最根本的问题！**

查看代码 `comparisonEngine.ts` 第 23-53 行：

```typescript
for (const para of data.paragraphs) {
  // ...
  blocks.push({
    index: para.index || blocks.length,
    text: displayText,
    pageIdx: (para.page || 1) - 1,  // ← 使用了 para.page
    type: para.type,
    // ...
  });
}
```

**问题**: 
- `blocks` 数组的顺序 = `data.paragraphs` 数组的顺序
- 如果 `data.paragraphs` 是乱序的，`blocks` 也是乱序的
- 后续的对齐和 diff 都基于这个乱序的 blocks 数组

**解决方案**: 
需要在 `parseVisualBlocks` 结束时，对 `blocks` 数组排序！

## 立即诊断步骤

### 步骤 1: 确认是否使用了新代码

在浏览器控制台运行：
```javascript
// 检查是否有新的排序日志
// 重新运行对比，查看控制台是否有：
// [BlockAlign] Sorted alignments by page and index order
```

**如果没有此日志 → 浏览器缓存问题**

### 步骤 2: 检查后端数据顺序

```javascript
const rightData = contractStore.getState().right.data;

console.log('=== 后端段落顺序 ===');
rightData.paragraphs?.slice(0, 20).forEach((p, idx) => {
  const text = p.lines?.[0]?.spans?.[0]?.content?.substring(0, 30) || '(空)';
  console.log(`[${idx}] page=${p.page}, index=${p.index}, text=${text}`);
});

// 检查 page 是否递增
// 如果看到 page 有递减，说明后端数据就是乱的
```

**如果 page 字段递减 → 后端数据问题**

### 步骤 3: 检查 blocks 数组顺序

```javascript
const result = diffStore.getState().comparisonResult;
const diffs = result?.textDiff?.diffs;

console.log('=== blocks 数组顺序 ===');
diffs?.slice(0, 20).forEach((d, idx) => {
  const block = d.rightBlock;
  console.log(`[${idx}] pageIdx=${block.pageIdx}, index=${block.index}, text=${block.text?.substring(0, 30)}`);
});

// 检查 pageIdx 是否递增
// 如果看到 pageIdx 递减，说明 blocks 数组没有排序
```

**如果 pageIdx 递减 → parseVisualBlocks 没有排序**

## 修复方案

### 方案 A: 强制刷新浏览器（如果是缓存问题）

**操作步骤**:
1. 关闭所有浏览器窗口
2. 重新打开浏览器
3. 清除缓存：
   - Chrome: `Ctrl + Shift + Delete`
   - 选择 "缓存的图片和文件"
   - 点击 "清除数据"
4. 硬刷新页面：`Ctrl + Shift + R`

### 方案 B: 在 parseVisualBlocks 结束时排序（如果是数据问题）

**修改位置**: `comparisonEngine.ts` 第 56 行（在 console.log 之前）

**添加代码**:
```typescript
// Sort blocks by page and index before returning
blocks.sort((a, b) => {
  if (a.pageIdx !== b.pageIdx) {
    return a.pageIdx - b.pageIdx;
  }
  return a.index - b.index;
});

console.log('[Parser] Sorted blocks by page and index order');
console.log('[Parser] Extracted', blocks.length, 'blocks from paragraphs');
```

**原理**: 
- 无论后端数据顺序如何，都在前端强制排序
- 确保 blocks 数组按照页码和索引递增
- 后续的对齐和渲染都基于正确顺序的 blocks

### 方案 C: 在 textEngine 中排序 diffs（双重保险）

**修改位置**: `textEngine.ts` 第 57 行之后

**添加代码**:
```typescript
// Sort diffs by page and index to ensure correct display order
diffs.sort((a, b) => {
  const getBlockInfo = (diff: CharacterDiff) => {
    // Use right block if left is empty, otherwise use left
    const block = diff.leftBlock.text ? diff.leftBlock : diff.rightBlock;
    return { pageIdx: block.pageIdx, index: block.index };
  };
  
  const aInfo = getBlockInfo(a);
  const bInfo = getBlockInfo(b);
  
  if (aInfo.pageIdx !== bInfo.pageIdx) {
    return aInfo.pageIdx - bInfo.pageIdx;
  }
  return aInfo.index - bInfo.index;
});

console.log('[TextEngine] Sorted diffs by page and index order');
```

## 推荐修复流程

### 立即执行：方案 A（清除缓存）

1. 彻底清除浏览器缓存
2. 重新加载页面
3. 重新上传对比
4. 检查是否有新日志

**如果问题仍存在 → 执行方案 B + C**

### 代码修复：方案 B + C（双重保险）

1. 修改 `parseVisualBlocks` 添加排序
2. 修改 `textEngine` 添加 diffs 排序
3. 重新构建
4. 强制刷新浏览器

## 测试验证

### 成功标志

1. ✅ 控制台看到新日志：
   ```
   [Parser] Sorted blocks by page and index order
   [BlockAlign] Sorted alignments by page and index order
   [TextEngine] Sorted diffs by page and index order
   ```

2. ✅ 右侧显示顺序：
   ```
   第1页 → 第2页 → 第3页 → 第4页 → 第5页
   ```

3. ✅ "面政治舆情..." 段落在第3页位置

### 失败情况

如果所有方案都不行，需要：
1. 提供完整的后端 JSON 数据样本
2. 提供浏览器控制台完整日志
3. 提供 localStorage 中的数据
4. 检查是否有其他代码在渲染时重新排序

## 紧急联系

如果需要立即修复，请提供：
1. 浏览器控制台的完整输出（包括所有 [Parser]、[BlockAlign]、[TextEngine] 日志）
2. 后端返回的原始 JSON（右侧合同的前 20 个段落）
3. 当前使用的浏览器版本

我会根据具体情况提供针对性的修复代码。
