# 检查文本截断问题的步骤

## 问题
"乙方展示地图有产生负" 这段文本后续内容被截断了

## 检查方法

### 方法1: 浏览器控制台检查

1. **打开开发者工具**
   - 按 `F12` 打开浏览器控制台
   - 切换到 **Console** 标签

2. **比对完成后，运行以下代码**

```javascript
// 获取比对结果
const result = window.lastComparisonDebug;

// 或者直接从store获取
const state = window.__diffStore?.getState?.() || 
              JSON.parse(localStorage.getItem('diffStore') || '{}');

// 查找包含"展示地图"的段落
const searchText = '展示地图';

// 检查左边合同
console.log('=== 检查左边合同 ===');
const leftData = window.__leftContractData;
if (leftData?.paragraphs) {
  leftData.paragraphs.forEach((para, i) => {
    if (para.text?.includes(searchText)) {
      console.log(`\n段落 ${i} (第${para.page}页):`);
      console.log('完整文本:', para.text);
      console.log('文本长度:', para.text.length);
      console.log('最后20个字符:', para.text.slice(-20));
    }
  });
}

// 检查右边合同
console.log('\n=== 检查右边合同 ===');
const rightData = window.__rightContractData;
if (rightData?.paragraphs) {
  rightData.paragraphs.forEach((para, i) => {
    if (para.text?.includes(searchText)) {
      console.log(`\n段落 ${i} (第${para.page}页):`);
      console.log('完整文本:', para.text);
      console.log('文本长度:', para.text.length);
      console.log('最后20个字符:', para.text.slice(-20));
    }
  });
}
```

### 方法2: 网络请求检查

1. **打开开发者工具的 Network 标签**
2. **刷新页面并重新比对**
3. **找到类似这样的请求**:
   ```
   GET /api/contracts/317e85b4-be79-460a-8b93-b95a3881051d/data
   GET /api/contracts/495d2807-bb78-4f71-aab3-6c3ab673ea64/data
   ```
4. **点击该请求，查看 Response 标签**
5. **搜索 "展示地图" 或 "产生负"**
6. **查看该段落的完整文本**

### 方法3: 直接API请求

在浏览器控制台运行：

```javascript
// 检查左边合同
fetch('http://127.0.0.1:18080/api/contracts/317e85b4-be79-460a-8b93-b95a3881051d/data')
  .then(r => r.json())
  .then(data => {
    const para = data.paragraphs.find(p => p.text?.includes('展示地图'));
    if (para) {
      console.log('=== 找到段落 ===');
      console.log('完整文本:', para.text);
      console.log('\n是否被截断:', !para.text.endsWith('。') && !para.text.endsWith('！'));
    } else {
      console.log('未找到包含"展示地图"的段落');
    }
  });

// 检查右边合同
fetch('http://127.0.0.1:18080/api/contracts/495d2807-bb78-4f71-aab3-6c3ab673ea64/data')
  .then(r => r.json())
  .then(data => {
    const para = data.paragraphs.find(p => p.text?.includes('展示地图'));
    if (para) {
      console.log('=== 找到段落 ===');
      console.log('完整文本:', para.text);
      console.log('\n是否被截断:', !para.text.endsWith('。') && !para.text.endsWith('！'));
    } else {
      console.log('未找到包含"展示地图"的段落');
    }
  });
```

## 需要确认的信息

请告诉我：

1. **后端返回的完整文本是什么？**
   - 是否包含"产生负"后面的内容？
   - 完整的句子/段落应该是什么？

2. **文本长度**
   - 字符数是多少？

3. **结尾字符**
   - 是否以标点符号结束（。！？）？
   - 还是突然截断？

4. **前端显示**
   - 前端显示的文本长度
   - 是否比后端返回的短？

## 可能的原因

### A. 后端截断
- OCR解析时就被截断了
- 需要检查后端解析逻辑

### B. 前端截断
- CSS样式限制 (如 `text-overflow: ellipsis`)
- JavaScript渲染时的长度限制
- HTML转义问题

### C. 数据传输问题
- JSON序列化时被截断
- 响应大小限制

---

## 临时解决方案

如果确认是前端显示问题，我可以：

1. **移除文本长度限制**
2. **检查CSS样式**
3. **修复渲染逻辑**

如果是后端问题，需要：

1. **检查OCR解析配置**
2. **查看原始PDF该段落的完整内容**
3. **调整后端的文本提取逻辑**

---

请先运行上面的方法检查，然后告诉我结果！
