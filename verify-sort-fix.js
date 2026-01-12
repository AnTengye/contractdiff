// 验证排序修复是否生效

console.log('=== 排序修复验证 ===\n');

// 模拟段落数据（从后端获取）
const mockParagraphs = [
    { page: 1, index: 0, text: "第1页内容" },
    { page: 2, index: 1, text: "第2页内容" },
    { page: 3, index: 4, text: "面政治舆情或损害国家安全..." },  // 用户报告的段落
    { page: 4, index: 10, text: "4.5乙方如需展示中国地图..." },
    { page: 5, index: 15, text: "第5页内容" },
];

console.log('输入的段落数据:');
mockParagraphs.forEach((p, i) => {
    console.log(`  [${i}] page=${p.page}, index=${p.index}, text=${p.text}`);
});

// 转换为 VisualBlock
const visualBlocks = mockParagraphs.map((p, i) => ({
    index: p.index,
    pageIdx: p.page - 1,  // page 从 1 开始，pageIdx 从 0 开始
    text: p.text,
    type: 'text',
    bbox: [0, 0, 0, 0],
    pageSize: [612, 792],
    lines: [],
    raw: p
}));

console.log('\n转换后的 VisualBlock:');
visualBlocks.forEach((vb, i) => {
    console.log(`  [${i}] pageIdx=${vb.pageIdx}, index=${vb.index}, text=${vb.text}`);
});

// 模拟对齐结果（假设有些块没有匹配）
const mockAlignments = [
    { leftIndex: 0, rightIndex: 0, matchType: 'exact', similarity: 1.0 },    // 第1页匹配
    { leftIndex: 1, rightIndex: 1, matchType: 'similar', similarity: 0.9 },  // 第2页匹配
    { leftIndex: null, rightIndex: 2, matchType: 'unmatched', similarity: 0 }, // 第3页未匹配！
    { leftIndex: 2, rightIndex: 3, matchType: 'similar', similarity: 0.85 }, // 第4页匹配
    { leftIndex: 3, rightIndex: 4, matchType: 'exact', similarity: 1.0 },    // 第5页匹配
];

console.log('\n对齐结果（排序前）:');
mockAlignments.forEach((a, i) => {
    const rightBlock = a.rightIndex !== null ? visualBlocks[a.rightIndex] : null;
    console.log(`  [${i}] leftIndex=${a.leftIndex}, rightIndex=${a.rightIndex}, pageIdx=${rightBlock?.pageIdx}, text=${rightBlock?.text}`);
});

// 应用我们的排序逻辑
const sortedAlignments = [...mockAlignments];

sortedAlignments.sort((a, b) => {
    const getBlockInfo = (alignment) => {
        const blockIndex = alignment.leftIndex !== null ? alignment.leftIndex : alignment.rightIndex;
        if (blockIndex === null) return { pageIdx: 999999, index: 999999 };
        
        const block = alignment.leftIndex !== null 
            ? visualBlocks[alignment.leftIndex] 
            : visualBlocks[alignment.rightIndex];
        
        return { pageIdx: block.pageIdx, index: block.index };
    };
    
    const aInfo = getBlockInfo(a);
    const bInfo = getBlockInfo(b);
    
    if (aInfo.pageIdx !== bInfo.pageIdx) {
        return aInfo.pageIdx - bInfo.pageIdx;
    }
    return aInfo.index - bInfo.index;
});

console.log('\n对齐结果（排序后 - 使用新逻辑）:');
sortedAlignments.forEach((a, i) => {
    const rightBlock = a.rightIndex !== null ? visualBlocks[a.rightIndex] : null;
    console.log(`  [${i}] leftIndex=${a.leftIndex}, rightIndex=${a.rightIndex}, pageIdx=${rightBlock?.pageIdx}, text=${rightBlock?.text}`);
});

console.log('\n=== 排序验证结果 ===');
let isSorted = true;
let lastPageIdx = -1;

sortedAlignments.forEach((a, i) => {
    const rightBlock = a.rightIndex !== null ? visualBlocks[a.rightIndex] : null;
    if (rightBlock) {
        if (rightBlock.pageIdx < lastPageIdx) {
            console.log(`❌ 错误：位置 ${i} 的 pageIdx=${rightBlock.pageIdx} 小于前一个 ${lastPageIdx}`);
            isSorted = false;
        }
        lastPageIdx = rightBlock.pageIdx;
    }
});

if (isSorted) {
    console.log('✅ 排序正确：所有段落按 pageIdx 递增');
} else {
    console.log('❌ 排序错误：存在 pageIdx 递减的情况');
}

console.log('\n=== 显示顺序预期 ===');
console.log('应该显示为:');
sortedAlignments.forEach((a, i) => {
    const rightBlock = a.rightIndex !== null ? visualBlocks[a.rightIndex] : null;
    if (rightBlock) {
        console.log(`  第${rightBlock.pageIdx + 1}页: ${rightBlock.text}`);
    }
});
