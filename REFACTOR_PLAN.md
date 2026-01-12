# 合同比对重构方案

## 问题分析

当前实现存在以下问题：

1. **文本比对不够精确**：段落合并逻辑可能导致差异丢失
2. **视觉比对映射不完整**：sourceBlocks 可能缺失或不准确
3. **比对逻辑耦合**：文本diff和视觉标注混在一起

## 重构目标

### 1. 调试/文本视图（Debug/Text View）
- **目标**：确保所有差异都能精确展示
- **策略**：
  - 使用字符级diff算法（diff-match-patch）
  - 不做任何段落合并或归一化（除了基本的空白符处理）
  - 确保每个字符级的变化都能被检测到
  - 支持按段落、按块（block）两种粒度展示

### 2. 原件视觉比对（Visual Annotation）
- **目标**：在PDF原件上精确标注所有差异
- **策略**：
  - 建立精确的文本到bbox的映射
  - 支持字符级、单词级、块级的标注
  - 处理跨行、跨块的差异
  - 确保标注位置与原文对应

## 新架构设计

```
services/diff/
├── text/                    # 文本比对模块
│   ├── index.ts
│   ├── characterDiff.ts     # 字符级diff
│   ├── blockDiff.ts         # 块级diff
│   └── types.ts            # 文本diff类型
│
├── visual/                  # 视觉比对模块
│   ├── index.ts
│   ├── textMapper.ts        # 文本到bbox映射
│   ├── annotationBuilder.ts # 标注构建器
│   └── types.ts            # 视觉比对类型
│
└── engine/                  # 比对引擎
    ├── index.ts
    ├── textEngine.ts        # 文本比对引擎
    └── visualEngine.ts      # 视觉比对引擎
```

## 实现步骤

### Phase 1: 文本比对重构
1. 创建新的文本比对模块
2. 实现精确的字符级diff
3. 实现块级diff（保持原始块结构）
4. 更新DiffPane组件使用新的diff结果

### Phase 2: 视觉比对重构
1. 创建文本到bbox的精确映射
2. 实现字符级位置追踪
3. 构建视觉标注（支持多种粒度）
4. 更新PDF标注渲染逻辑

### Phase 3: 测试与优化
1. 测试文本比对的准确性
2. 测试视觉标注的准确性
3. 性能优化
4. 边界情况处理

## 关键算法

### 文本比对算法
```typescript
// 使用diff-match-patch进行字符级比对
// 输入：两个文档的blocks数组
// 输出：每个block pair的详细diff
```

### 视觉映射算法
```typescript
// 构建字符索引到bbox的映射
// 输入：block with bbox + lines + spans
// 输出：字符位置 -> bbox坐标的映射表
```

### 标注合并算法
```typescript
// 合并相邻的同类型标注，减少渲染开销
// 输入：细粒度的标注数组
// 输出：合并后的标注数组
```
