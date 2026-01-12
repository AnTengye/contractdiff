# 问题修复说明

## 发现的问题

从图片可以看出，调试/文本视图显示"等待比对结果..."，说明：
1. 比对引擎可能没有正确触发
2. 或者数据解析失败，没有提取到任何块

## 已实施的修复

### 1. 增强调试日志
在 `comparisonEngine.ts` 中添加了详细的调试信息：
- 记录输入数据的结构（keys）
- 记录提取的块数量
- 当没有提取到块时，输出数据样本用于诊断

### 2. 改进文本提取逻辑
修复了 `extractBlockText` 函数：
```typescript
// 现在支持直接从 block.text 读取
if (block.text && typeof block.text === 'string') {
  return block.text;
}
```

### 3. 修复组件初始渲染
在 `DiffPaneV2.ts` 中：
```typescript
// 添加初始渲染，确保组件挂载时立即显示状态
private subscribeToStore(): void {
  this.unsubscribe = diffStore.subscribe((state) => {
    this.render(state);
  });
  
  // 立即渲染初始状态
  this.render(diffStore.getState());
}
```

## 如何诊断问题

现在刷新页面后，请按以下步骤操作：

### 1. 打开浏览器控制台（F12）

### 2. 上传合同并点击比对

### 3. 查看控制台输出

你应该能看到类似这样的日志：

```
[Parser] Input data type: object
[Parser] Has paragraphs: true
[Parser] Has pdf_info: false
[Parser] Using normalized format, paragraphs count: 150
[Parser] Extracted 150 blocks from paragraphs
[Engine] Starting comparison...
[Engine] Left data keys: ["paragraphs", "pdf_url", ...]
[Engine] Right data keys: ["paragraphs", "pdf_url", ...]
[Engine] Left visual blocks: 150
[Engine] Right visual blocks: 145
[TextEngine] Comparing 150 left blocks vs 145 right blocks
...
```

### 4. 如果看到问题

如果看到：
```
[Parser] Extracted 0 visual blocks
[Engine] No blocks extracted! Check data format.
[Engine] Sample left data: {...}
```

这说明数据格式不符合预期。请：
1. 复制控制台中的 "Sample left data" 内容
2. 告诉我数据的结构，我会相应调整解析器

## 测试步骤

### 方式1: 使用开发服务器
```bash
cd frontend
npm run dev
```
访问 http://localhost:5173

### 方式2: 使用构建版本
构建已完成，可以部署 `frontend/dist/` 目录到后端服务器。

## 预期结果

成功比对后，你应该看到：
1. **左右两侧文本视图**：显示带高亮的差异
2. **PDF视图**：在原件上用彩色框标注差异
3. **统计面板**：显示新增、删除、修改的数量
4. **控制台**：显示详细的比对统计信息

## 下一步

请刷新页面并测试，然后告诉我：
1. 控制台显示了什么日志？
2. 是否成功提取了块？（查看 "Extracted X visual blocks"）
3. 如果还是显示"等待比对结果..."，请复制完整的控制台输出给我
