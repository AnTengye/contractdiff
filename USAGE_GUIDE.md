# 合同比对系统 - 使用指南

## 快速开始

### 1. 启动开发服务器

```bash
cd frontend
npm run dev
```

前端将运行在 `http://localhost:5173`

确保后端服务已在 `http://127.0.0.1:18080` 运行。

### 2. 测试比对功能

使用提供的测试合同：
- 合同1: `contracts/317e85b4-be79-460a-8b93-b95a3881051d`
- 合同2: `contracts/495d2807-bb78-4f71-aab3-6c3ab673ea64`

## 新比对引擎特性

### 调试/文本视图

**精确度保证**：
- ✅ 字符级别的精确比对
- ✅ 使用 diff-match-patch 算法
- ✅ 不做任何段落合并（保留原始块结构）
- ✅ 所有差异都会被检测和显示

**显示效果**：
```
左侧文档：显示被删除和未变化的内容
右侧文档：显示被添加和未变化的内容

被删除的文本：红色背景高亮
被添加的文本：绿色背景高亮
未变化的文本：正常显示
```

### 原件视觉比对

**精确度保证**：
- ✅ 字符级别的 bbox 映射
- ✅ 精确追踪每个字符的位置
- ✅ 自动处理跨行、跨块的差异
- ✅ 智能合并相邻标注以优化显示

**标注样式**：
```
删除标注：红色边框 + 半透明红色填充
添加标注：绿色边框 + 半透明绿色填充
修改标注：黄色边框 + 半透明黄色填充
```

## 调试技巧

### 查看详细比对信息

打开浏览器控制台（F12），比对完成后：

```javascript
// 查看完整的调试信息
console.log(window.lastComparisonDebug);

// 输出示例：
// === Text Diff Results ===
// Total Alignments: 150
// Stats: {
//   totalBlocks: 150,
//   matchedBlocks: 120,
//   addedBlocks: 15,
//   deletedBlocks: 10,
//   modifiedBlocks: 5
// }
// 
// --- Diff #0 ---
// Alignment: L0 <-> R0 (exact, sim=1.00)
// Has Diff: false
// ...
```

### 检查映射统计

```javascript
// 获取当前比对结果
import { diffStore } from '@/store';
const state = diffStore.getState();

console.log('比对统计:', state.stats);
// {
//   added: 15,
//   removed: 10,
//   modified: 5,
//   total: 30,
//   visualStats: {
//     mapped: 2850,      // 成功映射到视觉位置的标注数
//     unmapped: 25       // 未能映射的字符数
//   }
// }
```

### 常见问题排查

**问题1：文本视图中看到差异，但PDF上没有标注**

可能原因：
- PDF解析时缺少 bbox 信息
- 字符映射失败

解决方案：
```javascript
// 查看 unmapped 统计
const state = diffStore.getState();
console.log('Unmapped chars:', state.stats.visualStats?.unmapped);

// 查看详细的 unmapped 信息
console.log(window.lastComparisonDebug);
// 搜索 "unmapped" 查看哪些差异未能映射
```

**问题2：标注位置不准确**

可能原因：
- PDF 坐标转换问题
- 缩放比例计算错误

解决方案：
```javascript
// 检查缩放级别
import { pdfStore } from '@/store';
console.log('Zoom level:', pdfStore.getState().zoomLevel);

// 查看具体标注的坐标
const result = diffStore.getState().comparisonResult;
if (result) {
  const leftAnnotations = result.visualDiff.leftAnnotations;
  for (const [pageIdx, annotations] of leftAnnotations.entries()) {
    console.log(`Page ${pageIdx}:`, annotations.length, 'annotations');
    console.log('First annotation:', annotations[0]);
  }
}
```

## 性能优化建议

### 大文档处理

对于超过100页的文档：

1. **启用标注合并**（默认已启用）：
```typescript
runComparisonV2(); // 默认 mergeAnnotations: true
```

2. **监控性能**：
```javascript
console.time('comparison');
runComparisonV2();
console.timeEnd('comparison');
```

### 内存使用

查看内存使用情况：
```javascript
// 查看比对结果的大小
const result = diffStore.getState().comparisonResult;
console.log('Diff count:', result?.textDiff.diffs.length);
console.log('Left annotations:', 
  Array.from(result?.visualDiff.leftAnnotations.values())
    .reduce((sum, arr) => sum + arr.length, 0)
);
console.log('Right annotations:', 
  Array.from(result?.visualDiff.rightAnnotations.values())
    .reduce((sum, arr) => sum + arr.length, 0)
);
```

## 算法参数调优

### 块对齐相似度阈值

当前默认值：`0.6` (60%)

如果需要调整（编辑 `frontend/src/services/diff/text/blockAlignment.ts`）：

```typescript
export function alignBlocks(
  leftBlocks: TextBlock[],
  rightBlocks: TextBlock[],
  threshold: number = 0.6  // 调整这个值
): BlockAlignment[]
```

- 提高阈值 (0.7-0.8)：更严格的匹配，可能导致更多unmatched块
- 降低阈值 (0.4-0.5)：更宽松的匹配，可能导致错误匹配

### 标注合并距离阈值

当前默认值：`2` 像素

如果需要调整（编辑 `frontend/src/services/diff/visual/annotationBuilder.ts`）：

```typescript
export function mergeAdjacentAnnotations(
  annotations: VisualAnnotation[],
  distanceThreshold: number = 2  // 调整这个值
): VisualAnnotation[]
```

## 集成到生产环境

### 构建生产版本

```bash
cd frontend
npm run build
```

构建产物在 `frontend/dist/` 目录。

### 部署检查清单

- [ ] TypeScript 类型检查通过
- [ ] 构建无错误
- [ ] 测试基本比对功能
- [ ] 测试大文档（>50页）性能
- [ ] 验证标注准确性
- [ ] 检查浏览器兼容性

## 下一步改进方向

### 短期优化
1. 添加进度条显示比对进度
2. 支持导出比对结果（JSON/PDF）
3. 添加差异导航功能（上一个/下一个差异）

### 中期功能
1. 支持表格结构比对
2. 支持图片内容比对
3. 添加差异类型过滤（只看添加/删除/修改）

### 长期愿景
1. AI 语义级比对
2. 批量文档比对
3. 版本历史追踪

## 技术支持

如遇到问题，请检查：
1. 浏览器控制台的错误信息
2. `window.lastComparisonDebug` 的调试输出
3. 后端API响应是否正常

详细文档参见：
- 重构方案：`REFACTOR_PLAN.md`
- 完成报告：`REFACTOR_COMPLETE.md`
