/**
 * 合同比对工具 - 核心逻辑
 */

// ===== DOM Elements =====
const uploadLeft = document.getElementById('upload-left');
const uploadRight = document.getElementById('upload-right');
const fileLeft = document.getElementById('file-left');
const fileRight = document.getElementById('file-right');
const infoLeft = document.getElementById('info-left');
const infoRight = document.getElementById('info-right');
const compareBtn = document.getElementById('compare-btn');
const statsSection = document.getElementById('stats-section');
const diffSection = document.getElementById('diff-section');
const diffLeft = document.getElementById('diff-left');
const diffRight = document.getElementById('diff-right');
const leftFilename = document.getElementById('left-filename');
const rightFilename = document.getElementById('right-filename');
const statAdded = document.getElementById('stat-added');
const statRemoved = document.getElementById('stat-removed');
const statTotal = document.getElementById('stat-total');

// ===== State =====
let leftData = null;
let rightData = null;
let leftContractId = null;
let rightContractId = null;
let leftPdfUrl = null;
let rightPdfUrl = null;

// ===== Event Listeners =====
uploadLeft.addEventListener('click', () => fileLeft.click());
uploadRight.addEventListener('click', () => fileRight.click());

// Drag and drop
[uploadLeft, uploadRight].forEach((el, idx) => {
    el.addEventListener('dragover', (e) => {
        e.preventDefault();
        el.classList.add('dragover');
    });

    el.addEventListener('dragleave', () => {
        el.classList.remove('dragover');
    });

    el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        const ext = file?.name.toLowerCase();
        if (file && (ext.endsWith('.pdf') || ext.endsWith('.docx'))) {
            handleFileUpload(file, idx === 0 ? 'left' : 'right');
        } else {
            alert('请上传 PDF 或 DOCX 文件');
        }
    });
});

fileLeft.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFileUpload(e.target.files[0], 'left');
});

fileRight.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFileUpload(e.target.files[0], 'right');
});

compareBtn.addEventListener('click', runComparison);

// ===== File Upload and Processing =====
// Track file types for preview rendering
let leftFileType = null;  // 'pdf' or 'docx'
let rightFileType = null;

async function handleFileUpload(file, side) {
    const uploadCard = side === 'left' ? uploadLeft : uploadRight;
    const info = side === 'left' ? infoLeft : infoRight;
    const progressContainer = document.getElementById(`progress-${side}`);
    const progressFill = document.getElementById(`progress-fill-${side}`);
    const progressText = document.getElementById(`progress-text-${side}`);
    const filenameSpan = side === 'left' ? leftFilename : rightFilename;

    // Detect file type
    const fileType = file.name.toLowerCase().endsWith('.docx') ? 'docx' : 'pdf';
    if (side === 'left') {
        leftFileType = fileType;
    } else {
        rightFileType = fileType;
    }

    // Reset state
    uploadCard.classList.remove('has-file');
    uploadCard.classList.add('processing');
    info.textContent = `📄 ${file.name}`;
    info.classList.add('show');
    progressContainer.style.display = 'block';
    progressFill.style.width = '10%';
    progressText.textContent = '上传中...';

    try {
        // Upload file
        const formData = new FormData();
        formData.append('file', file);

        const token = localStorage.getItem('auth_token');
        const uploadResponse = await fetch('/api/contracts/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        if (!uploadResponse.ok) {
            const error = await uploadResponse.json();
            throw new Error(`上传失败: ${error.error || '未知错误'}`);
        }

        const uploadResult = await uploadResponse.json();
        const contractId = uploadResult.id;
        const fileUrl = uploadResult.pdf_url;

        if (side === 'left') {
            leftContractId = contractId;
            leftPdfUrl = fileUrl;
        } else {
            rightContractId = contractId;
            rightPdfUrl = fileUrl;
        }

        // Show contract ID on the upload card for debugging
        const idDisplay = document.getElementById(`contract-id-${side}`);
        if (idDisplay) {
            idDisplay.textContent = `ID: ${contractId.substring(0, 8)}...`;
            idDisplay.title = contractId; // Full ID on hover
        }

        progressFill.style.width = '30%';
        progressText.textContent = 'MinerU 处理中...';

        // Poll for completion
        const jsonData = await pollForResult(contractId, progressFill, progressText);

        // Success
        if (side === 'left') {
            leftData = jsonData;
        } else {
            rightData = jsonData;
        }

        uploadCard.classList.remove('processing');
        uploadCard.classList.add('has-file');
        progressFill.style.width = '100%';
        progressText.textContent = '✓ 处理完成';
        filenameSpan.textContent = file.name;

        setTimeout(() => {
            progressContainer.style.display = 'none';
        }, 1500);

        console.log('JSON data received for', side, ':', jsonData);
        console.log('leftData:', leftData, 'rightData:', rightData);
        updateCompareButton();

    } catch (error) {
        uploadCard.classList.remove('processing');
        progressFill.style.width = '0%';

        // Show detailed error message with contract ID if available
        const contractId = side === 'left' ? leftContractId : rightContractId;
        const errorId = contractId ? ` [ID: ${contractId.substring(0, 8)}]` : '';
        progressText.textContent = `❌ ${error.message}${errorId}`;
        info.textContent = `❌ 失败: ${file.name}`;

        // Show error details for user to report
        console.error('Upload error:', error);
        console.error('Contract ID:', contractId);

        // Keep error visible (don't hide progress container)
    }
}

async function pollForResult(contractId, progressFill, progressText) {
    const token = localStorage.getItem('auth_token');
    const maxAttempts = 120; // 10 minutes with 5 second intervals
    let attempt = 0;

    while (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        attempt++;

        // Update progress (30% to 90%)
        const progress = 30 + Math.min(60, attempt * 2);
        progressFill.style.width = `${progress}%`;
        progressText.textContent = `MinerU 处理中... (${attempt * 5}秒)`;

        try {
            const statusResponse = await fetch(`/api/contracts/${contractId}/status`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!statusResponse.ok) continue;

            const status = await statusResponse.json();

            if (status.status === 'completed') {
                // Get full contract data with JSON
                const contractResponse = await fetch(`/api/contracts/${contractId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const contract = await contractResponse.json();
                console.log('Full contract response:', contract);
                console.log('json_data field:', contract.json_data);
                return contract.json_data;
            } else if (status.status === 'failed') {
                throw new Error(status.error_msg || '处理失败');
            } else {
                console.log('Current status:', status.status);
            }
        } catch (error) {
            if (error.message.includes('处理失败')) {
                throw error;
            }
            // Continue polling on network errors
        }
    }

    throw new Error('处理超时，请稍后重试');
}

function updateCompareButton() {
    console.log('updateCompareButton called - leftData:', !!leftData, 'rightData:', !!rightData);
    compareBtn.disabled = !(leftData && rightData);
    console.log('Compare button disabled:', compareBtn.disabled);
}

// ===== JSON Parsing =====

/**
 * 检查文本是否以完整的句子结尾（以句号、问号、感叹号等结束）
 * @param {string} text - 段落文本
 * @returns {boolean} 是否以句子结束标点结尾
 */
function endsWithCompleteSentence(text) {
    if (!text) return true;
    const trimmed = text.trim();
    // 中英文句子结束标点
    const sentenceEndingPunctuation = /[。！？.!?；;：:]$/;
    return sentenceEndingPunctuation.test(trimmed);
}

/**
 * 检查文本是否以段落序号开头（如 1.、1.1、（一）、第一条 等）
 * @param {string} text - 段落文本
 * @returns {boolean} 是否以序号开头
 */
function startsWithSectionNumber(text) {
    if (!text) return false;
    const trimmed = text.trim();

    const patterns = [
        // 阿拉伯数字序号: 1. 1.1 1.1.1 1、 1）
        /^\d+(?:\.\d+)*[\.\、）\)]\s*/,
        // 中文数字序号: 一、 （一） 第一条 第一章
        /^[（(]?[一二三四五六七八九十]+[）)、]\s*/,
        /^第[一二三四五六七八九十\d]+[条章节款项]\s*/,
        // 带括号的阿拉伯数字: (1) （1）
        /^[（(]\d+[）)]\s*/,
        // 字母序号: a. A. a) A)
        /^[a-zA-Z][\.\）\)]\s*/,
    ];

    return patterns.some(pattern => pattern.test(trimmed));
}

/**
 * 判断是否应该将前一个段落与当前段落合并
 * @param {Object} prevParagraph - 前一个段落
 * @param {Object} currentParagraph - 当前段落
 * @returns {boolean} 是否应该合并
 */
function shouldMergeParagraphs(prevParagraph, currentParagraph) {
    if (!prevParagraph || !currentParagraph) return false;

    // 条件1：前一段落没有以句子结束标点结尾
    if (endsWithCompleteSentence(prevParagraph.text)) return false;

    // 条件2：当前段落不是以序号开头（如果以序号开头，说明是新的条款）
    if (startsWithSectionNumber(currentParagraph.text)) return false;

    // 条件3：当前段落位于新的页面开头（可选检查，主要依赖上面两个条件）
    // 跨页的情况：pageIdx 不同
    if (prevParagraph.pageIdx === currentParagraph.pageIdx) {
        // 同一页内，通常不需要合并（除非是特殊的分割情况）
        // 但如果前一段没有结束标点且后一段不是序号开头，也考虑合并
        return true;
    }

    // 跨页情况：前一页最后一段未完成，下一页第一段是续接
    return true;
}

/**
 * 合并需要连接的段落
 * @param {Array} paragraphs - 原始段落数组
 * @returns {Array} 合并后的段落数组
 */
function mergeCrossPageParagraphs(paragraphs) {
    if (paragraphs.length <= 1) return paragraphs;

    const merged = [];
    let i = 0;

    while (i < paragraphs.length) {
        let current = { ...paragraphs[i] };

        // 检查是否需要与后续段落合并
        while (i + 1 < paragraphs.length && shouldMergeParagraphs(current, paragraphs[i + 1])) {
            // 合并文本
            current.text = current.text + paragraphs[i + 1].text;
            // 保留原始页码（使用起始页码）
            // current.pageIdx 保持不变
            i++;
        }

        merged.push(current);
        i++;
    }

    console.log(`Paragraph merge: ${paragraphs.length} -> ${merged.length} paragraphs`);
    return merged;
}

/**
 * 从 JSON 中提取所有文本段落
 * @param {Object} json - 解析后的 JSON 对象
 * @returns {Array} 段落数组，每个包含 text, type, pageIdx
 */
function parseContractJSON(json) {
    const pages = json.pdf_info || [];
    const paragraphs = [];

    for (const page of pages) {
        const pageIdx = page.page_idx;
        const blocks = page.para_blocks || [];

        for (const block of blocks) {
            const lines = block.lines || [];
            let blockText = '';

            // 处理普通块
            for (const line of lines) {
                for (const span of line.spans || []) {
                    if (span.content) {
                        blockText += span.content;
                    }
                }
            }

            // 处理嵌套的 blocks（如列表）
            if (block.blocks) {
                for (const subBlock of block.blocks) {
                    for (const line of subBlock.lines || []) {
                        for (const span of line.spans || []) {
                            if (span.content) {
                                blockText += span.content;
                            }
                        }
                    }
                    if (blockText) {
                        paragraphs.push({
                            text: blockText.trim(),
                            type: subBlock.type || block.type,
                            pageIdx: pageIdx
                        });
                        blockText = '';
                    }
                }
            } else if (blockText) {
                paragraphs.push({
                    text: blockText.trim(),
                    type: block.type,
                    pageIdx: pageIdx
                });
            }
        }
    }

    // 合并跨页分割的段落
    return mergeCrossPageParagraphs(paragraphs);
}


/**
 * 将段落数组转换为纯文本
 */
function paragraphsToText(paragraphs) {
    return paragraphs.map(p => p.text).join('\n');
}

// ===== Text Normalization =====
/**
 * 标准化文本用于比较（忽略空白和标点差异）
 * @param {string} text - 原始文本
 * @returns {string} 标准化后的文本
 */
function normalizeText(text) {
    if (!text) return '';

    return text
        // 移除所有空白字符（空格、换行、制表符等）
        .replace(/\s+/g, '')
        // 统一中英文标点
        .replace(/[，,]/g, ',')
        .replace(/[。.]/g, '.')
        .replace(/[：:]/g, ':')
        .replace(/[；;]/g, ';')
        .replace(/[（(]/g, '(')
        .replace(/[）)]/g, ')')
        .replace(/[""'']/g, '"')
        .replace(/[【\[]/g, '[')
        .replace(/[】\]]/g, ']')
        .replace(/[—-]/g, '-')
        // 移除常见无意义字符
        .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
        .toLowerCase();
}

/**
 * 提取合同段落的序号（如 1.、1.1、（一）、第一条 等）
 * @param {string} text - 段落文本
 * @returns {string|null} 提取的序号，如果没有返回 null
 */
function extractSectionNumber(text) {
    if (!text) return null;

    // 去除开头的空白
    const trimmed = text.trim();

    // 匹配各种序号格式
    const patterns = [
        // 阿拉伯数字序号: 1. 1.1 1.1.1 1、 1）
        /^(\d+(?:\.\d+)*)[\.、）\)]\s*/,
        // 中文数字序号: 一、 （一） 第一条 第一章
        /^[（(]?([一二三四五六七八九十]+)[）)、]\s*/,
        /^第([一二三四五六七八九十\d]+)[条章节款项]\s*/,
        // 带括号的阿拉伯数字: (1) （1）
        /^[（(](\d+)[）)]\s*/,
        // 字母序号: a. A. a) A)
        /^([a-zA-Z])[\.）\)]\s*/,
    ];

    for (const pattern of patterns) {
        const match = trimmed.match(pattern);
        if (match) {
            return match[1];
        }
    }

    return null;
}

/**
 * 标准化序号用于比较（将中文数字转为阿拉伯数字）
 * @param {string} num - 序号
 * @returns {string} 标准化后的序号
 */
function normalizeNumber(num) {
    if (!num) return '';

    const chineseNums = {
        '一': '1', '二': '2', '三': '3', '四': '4', '五': '5',
        '六': '6', '七': '7', '八': '8', '九': '9', '十': '10',
        '十一': '11', '十二': '12', '十三': '13', '十四': '14', '十五': '15'
    };

    // 如果是中文数字，转换
    if (chineseNums[num]) {
        return chineseNums[num];
    }

    return num.toLowerCase();
}

/**
 * 计算两个字符串的相似度（Jaccard 相似度）
 * @param {string} str1 
 * @param {string} str2 
 * @returns {number} 0-1 之间的相似度
 */
function calculateSimilarity(str1, str2) {
    const s1 = normalizeText(str1);
    const s2 = normalizeText(str2);

    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0.0;

    // 使用字符 n-gram 计算相似度
    const n = 2;
    const ngrams1 = new Set();
    const ngrams2 = new Set();

    for (let i = 0; i <= s1.length - n; i++) {
        ngrams1.add(s1.substring(i, i + n));
    }
    for (let i = 0; i <= s2.length - n; i++) {
        ngrams2.add(s2.substring(i, i + n));
    }

    if (ngrams1.size === 0 && ngrams2.size === 0) return 1.0;

    // Jaccard 相似度
    const intersection = new Set([...ngrams1].filter(x => ngrams2.has(x)));
    const union = new Set([...ngrams1, ...ngrams2]);

    return intersection.size / union.size;
}

// ===== Diff Computation =====
// 相似度阈值：高于此值认为是相同内容
const SIMILARITY_THRESHOLD = 0.85;

/**
 * 计算两个文本的差异
 * @param {string} text1 - 原始文本
 * @param {string} text2 - 对比文本
 * @returns {Array} diff 结果数组
 */
function computeDiff(text1, text2) {
    const dmp = new diff_match_patch();
    const diffs = dmp.diff_main(text1, text2);
    dmp.diff_cleanupSemantic(diffs);
    return diffs;
}

/**
 * 智能匹配段落（优先按序号匹配，然后按相似度匹配）
 * @param {Array} paragraphs1 - 原始段落
 * @param {Array} paragraphs2 - 对比段落
 * @returns {Array} 匹配结果
 */
function smartMatchParagraphs(paragraphs1, paragraphs2) {
    const matched1 = new Set();
    const matched2 = new Set();
    const pairs = [];

    // 第一轮：按序号匹配（优先级最高）
    for (let i = 0; i < paragraphs1.length; i++) {
        const num1 = extractSectionNumber(paragraphs1[i].text);
        if (!num1) continue;

        const normNum1 = normalizeNumber(num1);

        for (let j = 0; j < paragraphs2.length; j++) {
            if (matched2.has(j)) continue;

            const num2 = extractSectionNumber(paragraphs2[j].text);
            if (!num2) continue;

            const normNum2 = normalizeNumber(num2);

            // 序号匹配
            if (normNum1 === normNum2) {
                matched1.add(i);
                matched2.add(j);
                pairs.push({
                    left: paragraphs1[i],
                    right: paragraphs2[j],
                    similarity: calculateSimilarity(paragraphs1[i].text, paragraphs2[j].text),
                    isMatch: true,
                    matchType: 'number'
                });
                break;
            }
        }
    }

    // 第二轮：按相似度匹配未匹配的段落
    for (let i = 0; i < paragraphs1.length; i++) {
        if (matched1.has(i)) continue;

        let bestMatch = -1;
        let bestScore = SIMILARITY_THRESHOLD;

        for (let j = 0; j < paragraphs2.length; j++) {
            if (matched2.has(j)) continue;

            const similarity = calculateSimilarity(
                paragraphs1[i].text,
                paragraphs2[j].text
            );

            if (similarity > bestScore) {
                bestScore = similarity;
                bestMatch = j;
            }
        }

        if (bestMatch !== -1) {
            matched1.add(i);
            matched2.add(bestMatch);
            pairs.push({
                left: paragraphs1[i],
                right: paragraphs2[bestMatch],
                similarity: bestScore,
                isMatch: bestScore >= SIMILARITY_THRESHOLD
            });
        }
    }

    // 处理未匹配的左侧段落（删除）
    for (let i = 0; i < paragraphs1.length; i++) {
        if (!matched1.has(i)) {
            pairs.push({
                left: paragraphs1[i],
                right: { text: '', pageIdx: paragraphs1[i].pageIdx },
                similarity: 0,
                isMatch: false
            });
        }
    }

    // 处理未匹配的右侧段落（新增）
    for (let j = 0; j < paragraphs2.length; j++) {
        if (!matched2.has(j)) {
            pairs.push({
                left: { text: '', pageIdx: paragraphs2[j].pageIdx },
                right: paragraphs2[j],
                similarity: 0,
                isMatch: false
            });
        }
    }

    // 按页码和位置排序
    pairs.sort((a, b) => {
        const pageA = Math.max(a.left.pageIdx || 0, a.right.pageIdx || 0);
        const pageB = Math.max(b.left.pageIdx || 0, b.right.pageIdx || 0);
        return pageA - pageB;
    });

    return pairs;
}

/**
 * 按段落计算差异（使用智能匹配）
 */
function computeParagraphDiffs(paragraphs1, paragraphs2) {
    // 使用智能匹配
    const matchedPairs = smartMatchParagraphs(paragraphs1, paragraphs2);
    const results = [];

    for (const pair of matchedPairs) {
        // 检查标准化后是否相同
        const norm1 = normalizeText(pair.left.text);
        const norm2 = normalizeText(pair.right.text);

        // 如果标准化后相同，认为没有差异
        if (norm1 === norm2) {
            results.push({
                left: pair.left,
                right: pair.right,
                diffs: [[0, pair.left.text || pair.right.text]],
                hasDiff: false
            });
        } else {
            const diffs = computeDiff(pair.left.text, pair.right.text);
            // 过滤只有空白差异的情况
            const hasRealDiff = diffs.some(d => {
                if (d[0] === 0) return false;
                // 检查差异部分是否只是空白或标点
                const diffText = normalizeText(d[1]);
                return diffText.length > 0;
            });

            results.push({
                left: pair.left,
                right: pair.right,
                diffs: diffs,
                hasDiff: hasRealDiff
            });
        }
    }

    return results;
}


// ===== Rendering =====
/**
 * 渲染差异结果
 */
function renderDiff(paragraphDiffs) {
    let leftHTML = '';
    let rightHTML = '';
    let lastLeftPage = -1;
    let lastRightPage = -1;

    let addedCount = 0;
    let removedCount = 0;

    for (const result of paragraphDiffs) {
        // 页面标记
        if (result.left.pageIdx !== lastLeftPage && result.left.pageIdx >= 0) {
            leftHTML += `<div class="diff-page-marker">第 ${result.left.pageIdx + 1} 页</div>`;
            lastLeftPage = result.left.pageIdx;
        }
        if (result.right.pageIdx !== lastRightPage && result.right.pageIdx >= 0) {
            rightHTML += `<div class="diff-page-marker">第 ${result.right.pageIdx + 1} 页</div>`;
            lastRightPage = result.right.pageIdx;
        }

        // 生成带高亮的 HTML
        const diffClass = result.hasDiff ? 'has-diff' : '';

        let leftContent = '';
        let rightContent = '';

        for (const [op, text] of result.diffs) {
            const escapedText = escapeHtml(text);
            if (op === 0) {
                // 相同
                leftContent += escapedText;
                rightContent += escapedText;
            } else if (op === -1) {
                // 删除
                leftContent += `<span class="diff-removed">${escapedText}</span>`;
                removedCount++;
            } else if (op === 1) {
                // 新增
                rightContent += `<span class="diff-added">${escapedText}</span>`;
                addedCount++;
            }
        }

        if (leftContent || result.left.text) {
            leftHTML += `<div class="diff-paragraph ${diffClass}">${leftContent || escapeHtml(result.left.text)}</div>`;
        }
        if (rightContent || result.right.text) {
            rightHTML += `<div class="diff-paragraph ${diffClass}">${rightContent || escapeHtml(result.right.text)}</div>`;
        }
    }

    diffLeft.innerHTML = leftHTML;
    diffRight.innerHTML = rightHTML;

    // 更新统计
    statAdded.textContent = addedCount;
    statRemoved.textContent = removedCount;
    statTotal.textContent = addedCount + removedCount;

    // 显示结果区域
    statsSection.style.display = 'block';
    diffSection.style.display = 'block';

    // 滚动到结果
    statsSection.scrollIntoView({ behavior: 'smooth' });
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== Main Comparison =====
function runComparison() {
    if (!leftData || !rightData) return;

    // 显示加载状态
    diffLeft.innerHTML = '<div class="loading">正在分析...</div>';
    diffRight.innerHTML = '<div class="loading">正在分析...</div>';
    statsSection.style.display = 'block';
    diffSection.style.display = 'block';

    // 异步处理以避免 UI 阻塞
    setTimeout(() => {
        const leftParagraphs = parseContractJSON(leftData);
        const rightParagraphs = parseContractJSON(rightData);

        const paragraphDiffs = computeParagraphDiffs(leftParagraphs, rightParagraphs);

        renderDiff(paragraphDiffs);
    }, 100);
}

// ===== Initialize =====
console.log('合同比对工具已加载');

// ===== Store diff results for export =====
let lastParagraphDiffs = null;

// Override runComparison to store results and auto-load PDFs
const originalRunComparison = runComparison;
window.runComparison = function () {
    if (!leftData || !rightData) return;

    // 显示加载状态
    diffLeft.innerHTML = '<div class="loading">正在分析...</div>';
    diffRight.innerHTML = '<div class="loading">正在分析...</div>';
    statsSection.style.display = 'block';
    diffSection.style.display = 'block';

    // 异步处理以避免 UI 阻塞
    setTimeout(async () => {
        const leftParagraphs = parseContractJSON(leftData);
        const rightParagraphs = parseContractJSON(rightData);

        lastParagraphDiffs = computeParagraphDiffs(leftParagraphs, rightParagraphs);

        renderDiff(lastParagraphDiffs);

        // Auto-load documents from uploaded contracts
        if (leftPdfUrl) {
            console.log('Auto-loading left document from:', leftPdfUrl, 'type:', leftFileType);
            await loadDocumentFromUrl(leftPdfUrl, 'left', leftFileType);
        }
        if (rightPdfUrl) {
            console.log('Auto-loading right document from:', rightPdfUrl, 'type:', rightFileType);
            await loadDocumentFromUrl(rightPdfUrl, 'right', rightFileType);
        }

        // Auto-enable anchor sync mode for mixed format comparison (PDF vs DOCX)
        if (leftFileType !== rightFileType) {
            console.log('Mixed format detected, enabling anchor sync mode');
            syncScrollMode = 'anchor';
            updateSyncScrollUI();
        }
    }, 100);
};

// Load document from URL - routes to PDF or DOCX loader based on file type
async function loadDocumentFromUrl(url, side, fileType) {
    if (fileType === 'docx') {
        await loadDocxFromUrl(url, side);
    } else {
        await loadPdfFromUrl(url, side);
    }
}

// Load DOCX from URL and render with Mammoth.js
async function loadDocxFromUrl(url, side) {
    const filenameSpan = side === 'left' ? pdfFilenameLeft : pdfFilenameRight;
    const placeholder = side === 'left' ? pdfPlaceholderLeft : pdfPlaceholderRight;
    const container = side === 'left' ? pdfPagesContainerLeft : pdfPagesContainerRight;

    try {
        // Show loading state
        placeholder.classList.add('loading');
        placeholder.querySelector('p').textContent = '正在加载 DOCX...';
        filenameSpan.textContent = '加载中...';

        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();

        placeholder.querySelector('p').textContent = '正在渲染文档...';

        // Convert DOCX to HTML using Mammoth.js
        const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer });
        const docxHtml = result.value;

        // Hide placeholder, show container
        placeholder.classList.remove('loading');
        placeholder.style.display = 'none';
        container.style.display = 'flex';

        // Create a single page wrapper for DOCX content
        container.innerHTML = '';
        const pageWrapper = document.createElement('div');
        pageWrapper.className = 'pdf-page-wrapper docx-page-wrapper';

        const docxContent = document.createElement('div');
        docxContent.className = 'docx-content';
        docxContent.innerHTML = docxHtml;

        pageWrapper.appendChild(docxContent);
        container.appendChild(pageWrapper);

        // Add paragraph markers for scroll sync
        addDocxParagraphMarkers(docxContent);

        // Apply diff highlighting if diff results are available
        if (lastParagraphDiffs && lastParagraphDiffs.length > 0) {
            applyDocxDiffHighlights(docxContent, side);
        }

        // Store reference for annotations
        if (side === 'left') {
            pdfDocLeft = null; // Clear PDF doc reference
        } else {
            pdfDocRight = null;
        }

        filenameSpan.textContent = '✓ DOCX 已加载';
    } catch (err) {
        console.error(`Failed to load DOCX for ${side}:`, err);
        placeholder.classList.remove('loading');
        placeholder.querySelector('p').textContent = '⚠ DOCX 加载失败';
        filenameSpan.textContent = '加载失败';
    }
}

/**
 * Add paragraph markers to DOCX content for scroll sync
 * Marks each paragraph with data-paragraph-idx attribute
 */
function addDocxParagraphMarkers(docxElement) {
    // Get all block-level elements that represent paragraphs
    const paragraphElements = docxElement.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');

    let idx = 0;
    paragraphElements.forEach(el => {
        // Only mark elements with meaningful text content
        if (el.textContent.trim().length > 5) {
            el.setAttribute('data-paragraph-idx', idx);
            el.classList.add('docx-paragraph');
            idx++;
        }
    });

    console.log(`[DOCX] Marked ${idx} paragraphs for scroll sync`);
}

/**
 * Apply diff highlighting to DOCX content
 * For left side: highlight deleted text (shown in original)
 * For right side: highlight added text (shown in compared)
 */
function applyDocxDiffHighlights(docxElement, side) {
    if (!lastParagraphDiffs) return;

    // Collect all diff texts to highlight
    const textsToHighlight = [];

    for (const result of lastParagraphDiffs) {
        if (!result.hasDiff) continue;

        for (const [op, text] of result.diffs) {
            // Skip unchanged or empty text
            if (op === 0 || !text.trim()) continue;

            // Left side: show deleted (-1), Right side: show added (+1)
            if (side === 'left' && op === -1) {
                textsToHighlight.push({ text: text, type: 'removed' });
            } else if (side === 'right' && op === 1) {
                textsToHighlight.push({ text: text, type: 'added' });
            }
        }
    }

    // Apply highlights to the HTML content
    if (textsToHighlight.length > 0) {
        highlightTextsInElement(docxElement, textsToHighlight);
    }
}

/**
 * Highlight specific texts within an element
 */
function highlightTextsInElement(element, textsToHighlight) {
    // For each text to highlight, find and wrap it
    for (const item of textsToHighlight) {
        const searchText = item.text;
        if (!searchText || searchText.length < 2) continue; // Skip very short texts

        const highlightClass = item.type === 'removed' ? 'docx-highlight-removed' : 'docx-highlight-added';

        // Re-walk the tree for each search (since DOM changes)
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let node;
        let found = false;
        while ((node = walker.nextNode()) && !found) {
            const content = node.textContent;
            if (!content) continue;

            const index = content.indexOf(searchText);

            if (index !== -1) {
                const parent = node.parentNode;
                if (!parent) continue; // Safety check

                // Found the text, split and wrap
                try {
                    // Create document fragment with highlighted span
                    const fragment = document.createDocumentFragment();

                    // Text before match
                    if (index > 0) {
                        fragment.appendChild(document.createTextNode(content.substring(0, index)));
                    }

                    // Highlighted text
                    const span = document.createElement('span');
                    span.className = highlightClass;
                    span.textContent = searchText;
                    fragment.appendChild(span);

                    // Text after match
                    if (index + searchText.length < content.length) {
                        fragment.appendChild(document.createTextNode(content.substring(index + searchText.length)));
                    }

                    parent.replaceChild(fragment, node);
                    found = true;
                } catch (e) {
                    console.warn('Failed to highlight text:', searchText, e);
                }
            }
        }
    }
}

// Load PDF from URL for the PDF viewer
async function loadPdfFromUrl(url, side) {
    const filenameSpan = side === 'left' ? pdfFilenameLeft : pdfFilenameRight;
    const placeholder = side === 'left' ? pdfPlaceholderLeft : pdfPlaceholderRight;
    const container = side === 'left' ? pdfPagesContainerLeft : pdfPagesContainerRight;

    try {
        // Show loading state
        placeholder.classList.add('loading');
        placeholder.querySelector('p').textContent = '正在加载 PDF...';
        filenameSpan.textContent = '加载中...';

        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();

        placeholder.querySelector('p').textContent = '正在渲染页面...';

        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        if (side === 'left') {
            pdfDocLeft = pdfDoc;
        } else {
            pdfDocRight = pdfDoc;
        }

        // Hide placeholder, show container
        placeholder.classList.remove('loading');
        placeholder.style.display = 'none';
        container.style.display = 'flex';

        // Render all pages
        await renderAllPagesForSide(side);

        // Prepare and draw annotations
        if (leftData && rightData) {
            prepareAnnotationsEnhanced();
            drawAllAnnotationsForSide(side);
        }

        filenameSpan.textContent = '✓ PDF 已加载';
    } catch (err) {
        console.error(`Failed to load PDF for ${side}:`, err);
        placeholder.classList.remove('loading');
        placeholder.querySelector('p').textContent = '⚠ PDF 加载失败';
        filenameSpan.textContent = '加载失败';
    }
}

// Re-bindcompareBtn to use the new function
compareBtn.removeEventListener('click', runComparison);
compareBtn.addEventListener('click', window.runComparison);



// ===== Dual PDF Viewer Module (Multi-Page) =====
const pdfSection = document.getElementById('pdf-section');

// Left PDF elements
const pdfFilenameLeft = document.getElementById('pdf-filename-left');
const pdfPagesContainerLeft = document.getElementById('pdf-pages-left');
const pdfPlaceholderLeft = document.getElementById('pdf-placeholder-left');

// Right PDF elements
const pdfFilenameRight = document.getElementById('pdf-filename-right');
const pdfPagesContainerRight = document.getElementById('pdf-pages-right');
const pdfPlaceholderRight = document.getElementById('pdf-placeholder-right');

// Zoom elements
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomLevelSpan = document.getElementById('zoom-level');

// PDF State
let pdfDocLeft = null;
let pdfDocRight = null;
let zoomLevel = 1.0; // Default zoom
let leftAnnotations = {}; // Annotations for left PDF (deletions)
let rightAnnotations = {}; // Annotations for right PDF (additions)

// PDF Event Listeners (zoom only - file inputs removed, using auto-load)
zoomInBtn.addEventListener('click', () => changeZoom(0.25));
zoomOutBtn.addEventListener('click', () => changeZoom(-0.25));

/**
 * Handle PDF file upload for left or right panel
 */
async function handlePDFViewerUpload(e, side) {
    const file = e.target.files[0];
    if (!file) return;

    const filenameSpan = side === 'left' ? pdfFilenameLeft : pdfFilenameRight;
    const placeholder = side === 'left' ? pdfPlaceholderLeft : pdfPlaceholderRight;
    const container = side === 'left' ? pdfPagesContainerLeft : pdfPagesContainerRight;

    filenameSpan.textContent = `✓ ${file.name}`;

    const arrayBuffer = await file.arrayBuffer();

    try {
        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        if (side === 'left') {
            pdfDocLeft = pdfDoc;
        } else {
            pdfDocRight = pdfDoc;
        }

        // Hide placeholder, show container
        placeholder.style.display = 'none';
        container.style.display = 'flex';

        // Render all pages
        await renderAllPagesForSide(side);

        // Prepare and draw annotations
        if (leftData && rightData) {
            prepareAnnotationsEnhanced();
            drawAllAnnotationsForSide(side);
        }
    } catch (err) {
        alert(`PDF 加载失败 (${side}): ${err.message}`);
    }
}

/**
 * Render all pages for one side
 */
async function renderAllPagesForSide(side) {
    const pdfDoc = side === 'left' ? pdfDocLeft : pdfDocRight;
    const container = side === 'left' ? pdfPagesContainerLeft : pdfPagesContainerRight;

    if (!pdfDoc) return;

    // Clear existing pages
    container.innerHTML = '';

    // Render each page
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const pageWrapper = await renderSinglePage(pdfDoc, pageNum, side);
        container.appendChild(pageWrapper);
    }
}

/**
 * Render a single page and return the wrapper element
 */
async function renderSinglePage(pdfDoc, pageNum, side) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: zoomLevel });

    // Create page wrapper
    const pageWrapper = document.createElement('div');
    pageWrapper.className = 'pdf-page-wrapper';
    pageWrapper.dataset.pageNum = pageNum;

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.className = 'pdf-canvas';

    // Create SVG overlay
    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.setAttribute('width', viewport.width);
    overlay.setAttribute('height', viewport.height);
    overlay.setAttribute('class', 'pdf-overlay');
    overlay.dataset.pageNum = pageNum;
    overlay.id = `pdf-overlay-${side}-page-${pageNum}`;

    pageWrapper.appendChild(canvas);
    pageWrapper.appendChild(overlay);

    // Render PDF page to canvas
    const ctx = canvas.getContext('2d');
    await page.render({
        canvasContext: ctx,
        viewport: viewport
    }).promise;

    return pageWrapper;
}

/**
 * Re-render all pages for both sides (used when zoom changes)
 */
async function reRenderAllPages() {
    if (pdfDocLeft) {
        await renderAllPagesForSide('left');
        drawAllAnnotationsForSide('left');
    }
    if (pdfDocRight) {
        await renderAllPagesForSide('right');
        drawAllAnnotationsForSide('right');
    }
}

/**
 * Change zoom level
 */
function changeZoom(delta) {
    const newZoom = Math.max(0.5, Math.min(3, zoomLevel + delta));
    if (newZoom === zoomLevel) return;

    zoomLevel = newZoom;
    zoomLevelSpan.textContent = Math.round(zoomLevel * 100) + '%';

    reRenderAllPages();
}

/**
 * Prepare annotations for both sides from diff data
 * Left side: deleted content (from original)
 * Right side: added content (from compared)
 */
function prepareAnnotationsForBothSides() {
    leftAnnotations = {};
    rightAnnotations = {};

    if (!leftData || !rightData) return;

    // Extract blocks with bbox from both JSONs
    const leftBlocks = extractBlocksWithBbox(leftData);
    const rightBlocks = extractBlocksWithBbox(rightData);

    // Track matched blocks
    const matchedLeft = new Set();
    const matchedRight = new Set();

    // First pass: match by section number (priority)
    for (let i = 0; i < leftBlocks.length; i++) {
        const lb = leftBlocks[i];
        const num1 = extractSectionNumber(lb.text);
        if (!num1) continue;

        const normNum1 = normalizeNumber(num1);

        for (let j = 0; j < rightBlocks.length; j++) {
            if (matchedRight.has(j)) continue;

            const num2 = extractSectionNumber(rightBlocks[j].text);
            if (!num2) continue;

            const normNum2 = normalizeNumber(num2);

            if (normNum1 === normNum2) {
                matchedLeft.add(i);
                matchedRight.add(j);
                break;
            }
        }
    }

    // Second pass: exact normalized text match
    for (let i = 0; i < leftBlocks.length; i++) {
        if (matchedLeft.has(i)) continue;

        const lb = leftBlocks[i];
        const normText = normalizeText(lb.text);

        for (let j = 0; j < rightBlocks.length; j++) {
            if (matchedRight.has(j)) continue;

            if (normalizeText(rightBlocks[j].text) === normText) {
                matchedLeft.add(i);
                matchedRight.add(j);
                break;
            }
        }
    }

    // Third pass: similarity-based match for unmatched blocks
    for (let i = 0; i < leftBlocks.length; i++) {
        if (matchedLeft.has(i)) continue;

        const lb = leftBlocks[i];
        let bestMatch = -1;
        let bestScore = SIMILARITY_THRESHOLD;

        for (let j = 0; j < rightBlocks.length; j++) {
            if (matchedRight.has(j)) continue;

            const similarity = calculateSimilarity(lb.text, rightBlocks[j].text);
            if (similarity > bestScore) {
                bestScore = similarity;
                bestMatch = j;
            }
        }

        if (bestMatch !== -1) {
            matchedLeft.add(i);
            matchedRight.add(bestMatch);
        }
    }

    // Mark unmatched left blocks as deletions
    for (let i = 0; i < leftBlocks.length; i++) {
        if (matchedLeft.has(i)) continue;

        const lb = leftBlocks[i];
        // Skip if text is too short (likely just punctuation or numbers)
        if (normalizeText(lb.text).length < 3) continue;

        const pageIdx = lb.pageIdx;
        if (!leftAnnotations[pageIdx]) {
            leftAnnotations[pageIdx] = [];
        }
        leftAnnotations[pageIdx].push({
            bbox: lb.bbox,
            pageSize: lb.pageSize,
            type: 'removed',
            text: lb.text
        });
    }

    // Mark unmatched right blocks as additions
    for (let j = 0; j < rightBlocks.length; j++) {
        if (matchedRight.has(j)) continue;

        const rb = rightBlocks[j];
        // Skip if text is too short
        if (normalizeText(rb.text).length < 3) continue;

        const pageIdx = rb.pageIdx;
        if (!rightAnnotations[pageIdx]) {
            rightAnnotations[pageIdx] = [];
        }
        rightAnnotations[pageIdx].push({
            bbox: rb.bbox,
            pageSize: rb.pageSize,
            type: 'added',
            text: rb.text
        });
    }
}

/**
 * Extract all text blocks with bbox from JSON
 */
function extractBlocksWithBbox(json) {
    const blocks = [];
    const pages = json.pdf_info || [];

    for (const page of pages) {
        const pageIdx = page.page_idx;
        const pageSize = page.page_size || [595, 842];

        for (const block of page.para_blocks || []) {
            const bbox = block.bbox;
            if (!bbox) continue;

            // Extract text from block
            let text = '';
            for (const line of block.lines || []) {
                for (const span of line.spans || []) {
                    if (span.content) {
                        text += span.content;
                    }
                }
            }

            // Handle nested blocks
            if (block.blocks) {
                for (const subBlock of block.blocks) {
                    let subText = '';
                    for (const line of subBlock.lines || []) {
                        for (const span of line.spans || []) {
                            if (span.content) {
                                subText += span.content;
                            }
                        }
                    }
                    if (subText && subBlock.bbox) {
                        blocks.push({
                            bbox: subBlock.bbox,
                            text: subText.trim(),
                            pageIdx: pageIdx,
                            pageSize: pageSize
                        });
                    }
                }
            } else if (text) {
                blocks.push({
                    bbox: bbox,
                    text: text.trim(),
                    pageIdx: pageIdx,
                    pageSize: pageSize
                });
            }
        }
    }

    return blocks;
}

// ===== Character-Level Coordinate Mapping (Phase 1 & 2) =====

/**
 * Build character-level index from JSON
 * Maps each character position to its corresponding bbox
 * @param {Object} json - Parsed JSON object
 * @returns {Object} Character index with blocks and total character count
 */
function buildCharacterIndex(json) {
    const pages = json.pdf_info || [];
    const index = {
        pages: [],
        totalChars: 0
    };

    let globalCharOffset = 0;

    for (const page of pages) {
        const pageIdx = page.page_idx;
        const pageSize = page.page_size || [595, 842];
        const pageBlocks = [];

        const processBlock = (block, parentBbox = null) => {
            const lines = block.lines || [];
            let blockText = '';
            const spans = [];

            for (const line of lines) {
                for (const span of line.spans || []) {
                    if (span.content && span.bbox) {
                        spans.push({
                            text: span.content,
                            bbox: span.bbox,
                            charStart: globalCharOffset + blockText.length,
                            charEnd: globalCharOffset + blockText.length + span.content.length
                        });
                        blockText += span.content;
                    }
                }
            }

            if (blockText) {
                pageBlocks.push({
                    text: blockText,
                    bbox: block.bbox || parentBbox,
                    spans: spans,
                    charStart: globalCharOffset,
                    charEnd: globalCharOffset + blockText.length,
                    pageIdx: pageIdx,
                    pageSize: pageSize
                });
                globalCharOffset += blockText.length;
            }
        };

        for (const block of page.para_blocks || []) {
            if (block.blocks) {
                // Nested blocks (lists)
                for (const subBlock of block.blocks) {
                    processBlock(subBlock, block.bbox);
                }
            } else {
                processBlock(block);
            }
        }

        index.pages.push({
            pageIdx: pageIdx,
            pageSize: pageSize,
            blocks: pageBlocks
        });
    }

    index.totalChars = globalCharOffset;
    return index;
}

/**
 * Find bbox(es) for a character range
 * @param {Object} index - Character index from buildCharacterIndex
 * @param {number} startChar - Start character position
 * @param {number} endChar - End character position
 * @returns {Array} Array of {bbox, pageIdx, pageSize} objects
 */
function findBboxForCharRange(index, startChar, endChar) {
    const results = [];

    for (const page of index.pages) {
        for (const block of page.blocks) {
            // Skip blocks that don't overlap with our range
            if (block.charEnd <= startChar || block.charStart >= endChar) continue;

            // Check if we can use span-level precision
            let foundSpan = false;
            for (const span of block.spans) {
                if (span.charEnd <= startChar || span.charStart >= endChar) continue;

                results.push({
                    bbox: span.bbox,
                    pageIdx: block.pageIdx,
                    pageSize: block.pageSize,
                    text: span.text
                });
                foundSpan = true;
            }

            // Fallback to block-level bbox if no spans matched
            if (!foundSpan && block.bbox) {
                results.push({
                    bbox: block.bbox,
                    pageIdx: block.pageIdx,
                    pageSize: block.pageSize,
                    text: block.text
                });
            }
        }
    }

    return results;
}

/**
 * Map diff results to bbox annotations
 * @param {Array} diffs - diff_match_patch results [[op, text], ...]
 * @param {Object} leftIndex - Character index for left document
 * @param {Object} rightIndex - Character index for right document
 * @returns {Object} {leftAnnotations, rightAnnotations} - Annotations by page
 */
function mapDiffToBbox(diffs, leftIndex, rightIndex) {
    const leftAnns = {};
    const rightAnns = {};

    let leftCharPos = 0;
    let rightCharPos = 0;
    let pairId = 0;

    for (const [op, text] of diffs) {
        const textLen = text.length;

        if (op === 0) {
            // Equal - advance both positions
            leftCharPos += textLen;
            rightCharPos += textLen;
        } else if (op === -1) {
            // Deletion - text exists in left, not in right
            const bboxes = findBboxForCharRange(leftIndex, leftCharPos, leftCharPos + textLen);

            for (const item of bboxes) {
                const pageIdx = item.pageIdx;
                if (!leftAnns[pageIdx]) leftAnns[pageIdx] = [];
                leftAnns[pageIdx].push({
                    bbox: item.bbox,
                    pageSize: item.pageSize,
                    type: 'removed',
                    text: text,
                    pairId: `diff_${pairId}`
                });
            }

            leftCharPos += textLen;
            pairId++;
        } else if (op === 1) {
            // Addition - text exists in right, not in left
            const bboxes = findBboxForCharRange(rightIndex, rightCharPos, rightCharPos + textLen);

            for (const item of bboxes) {
                const pageIdx = item.pageIdx;
                if (!rightAnns[pageIdx]) rightAnns[pageIdx] = [];
                rightAnns[pageIdx].push({
                    bbox: item.bbox,
                    pageSize: item.pageSize,
                    type: 'added',
                    text: text,
                    pairId: `diff_${pairId}`
                });
            }

            rightCharPos += textLen;
            pairId++;
        }
    }

    return { leftAnnotations: leftAnns, rightAnnotations: rightAnns };
}

/**
 * Prepare annotations based on paragraph-level diff results
 * This is more accurate than full-text diff because it uses the same 
 * paragraph matching logic as the text diff display
 */
function prepareAnnotationsEnhanced() {
    leftAnnotations = {};
    rightAnnotations = {};

    if (!leftData || !rightData || !lastParagraphDiffs) return;

    // Extract blocks with bbox from both JSONs for coordinate lookup
    const leftBlocks = extractBlocksWithBbox(leftData);
    const rightBlocks = extractBlocksWithBbox(rightData);

    // Create lookup maps by normalized text for finding blocks
    const leftBlockMap = new Map();
    for (const block of leftBlocks) {
        const normText = normalizeText(block.text);
        if (normText.length > 0) {
            if (!leftBlockMap.has(normText)) {
                leftBlockMap.set(normText, []);
            }
            leftBlockMap.get(normText).push(block);
        }
    }

    const rightBlockMap = new Map();
    for (const block of rightBlocks) {
        const normText = normalizeText(block.text);
        if (normText.length > 0) {
            if (!rightBlockMap.has(normText)) {
                rightBlockMap.set(normText, []);
            }
            rightBlockMap.get(normText).push(block);
        }
    }

    // Process each paragraph diff result
    for (const result of lastParagraphDiffs) {
        // Skip if no real difference
        if (!result.hasDiff) continue;

        const leftText = result.left.text || '';
        const rightText = result.right.text || '';

        // Check what type of difference this is
        const hasLeftContent = leftText.trim().length > 0;
        const hasRightContent = rightText.trim().length > 0;

        if (hasLeftContent && !hasRightContent) {
            // Pure deletion - content in left but not in right
            const normLeft = normalizeText(leftText);
            const matchingBlocks = leftBlockMap.get(normLeft) || [];

            for (const block of matchingBlocks) {
                const pageIdx = block.pageIdx;
                if (!leftAnnotations[pageIdx]) leftAnnotations[pageIdx] = [];
                leftAnnotations[pageIdx].push({
                    bbox: block.bbox,
                    pageSize: block.pageSize,
                    type: 'removed',
                    text: leftText.substring(0, 50) + (leftText.length > 50 ? '...' : '')
                });
            }
        } else if (!hasLeftContent && hasRightContent) {
            // Pure addition - content in right but not in left
            const normRight = normalizeText(rightText);
            const matchingBlocks = rightBlockMap.get(normRight) || [];

            for (const block of matchingBlocks) {
                const pageIdx = block.pageIdx;
                if (!rightAnnotations[pageIdx]) rightAnnotations[pageIdx] = [];
                rightAnnotations[pageIdx].push({
                    bbox: block.bbox,
                    pageSize: block.pageSize,
                    type: 'added',
                    text: rightText.substring(0, 50) + (rightText.length > 50 ? '...' : '')
                });
            }
        } else if (hasLeftContent && hasRightContent) {
            // Modification - both have content but they differ
            // Find matching blocks for both sides
            const normLeft = normalizeText(leftText);
            const normRight = normalizeText(rightText);

            const leftMatchingBlocks = leftBlockMap.get(normLeft) || [];
            const rightMatchingBlocks = rightBlockMap.get(normRight) || [];

            // Mark left side as having modification (will show deletions)
            for (const block of leftMatchingBlocks) {
                const pageIdx = block.pageIdx;
                if (!leftAnnotations[pageIdx]) leftAnnotations[pageIdx] = [];
                leftAnnotations[pageIdx].push({
                    bbox: block.bbox,
                    pageSize: block.pageSize,
                    type: 'removed',
                    text: '修改: ' + leftText.substring(0, 40) + '...'
                });
            }

            // Mark right side as having modification (will show additions)
            for (const block of rightMatchingBlocks) {
                const pageIdx = block.pageIdx;
                if (!rightAnnotations[pageIdx]) rightAnnotations[pageIdx] = [];
                rightAnnotations[pageIdx].push({
                    bbox: block.bbox,
                    pageSize: block.pageSize,
                    type: 'added',
                    text: '修改: ' + rightText.substring(0, 40) + '...'
                });
            }
        }
    }

    // Log summary for debugging
    let leftCount = 0, rightCount = 0;
    for (const pageIdx in leftAnnotations) leftCount += leftAnnotations[pageIdx].length;
    for (const pageIdx in rightAnnotations) rightCount += rightAnnotations[pageIdx].length;
    console.log(`Annotations prepared: ${leftCount} deletions, ${rightCount} additions`);
}

// Store indices for sync scroll
let leftCharIndex = null;
let rightCharIndex = null;

/**
 * Draw annotations for a specific page on a specific side
 * @param {number} pageNum - Page number (1-indexed)
 * @param {string} side - 'left' or 'right'
 */
function drawAnnotationsForPage(pageNum, side) {
    const overlay = document.getElementById(`pdf-overlay-${side}-page-${pageNum}`);
    if (!overlay) return;

    const annotations = side === 'left' ? leftAnnotations : rightAnnotations;

    // Clear existing annotations
    overlay.innerHTML = '';

    const pageAnns = annotations[pageNum - 1] || [];
    if (pageAnns.length === 0) return;

    for (const ann of pageAnns) {
        // Convert PDF coordinates to canvas coordinates
        const rect = pdfBboxToCanvas(ann.bbox, ann.pageSize);

        // Create SVG rectangle
        const svgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        svgRect.setAttribute('x', rect.x);
        svgRect.setAttribute('y', rect.y);
        svgRect.setAttribute('width', rect.width);
        svgRect.setAttribute('height', rect.height);
        svgRect.setAttribute('rx', '3');
        svgRect.setAttribute('class', ann.type === 'removed' ? 'highlight-removed' : 'highlight-added');

        // Add tooltip with diff text
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = ann.text || '';
        svgRect.appendChild(title);

        overlay.appendChild(svgRect);
    }
}

/**
 * Draw all annotations for one side (all pages)
 */
function drawAllAnnotationsForSide(side) {
    const pdfDoc = side === 'left' ? pdfDocLeft : pdfDocRight;
    if (!pdfDoc) return;

    const annotations = side === 'left' ? leftAnnotations : rightAnnotations;

    // Draw annotations for each page
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        drawAnnotationsForPage(pageNum, side);
    }

    // Log annotation count for debugging
    let totalAnns = 0;
    for (const pageIdx in annotations) {
        totalAnns += annotations[pageIdx].length;
    }
    console.log(`${side} side: ${totalAnns} annotations across ${Object.keys(annotations).length} pages`);
}

/**
 * Convert PDF bbox to canvas coordinates
 */
function pdfBboxToCanvas(bbox, pageSize) {
    const [x1, y1, x2, y2] = bbox;

    // Scale factor
    const scale = zoomLevel;

    return {
        x: x1 * scale,
        y: y1 * scale,
        width: (x2 - x1) * scale,
        height: (y2 - y1) * scale
    };
}

/**
 * Show PDF section after comparison
 */
function showPDFSection() {
    pdfSection.style.display = 'block';

    // Use enhanced annotations for more precise highlighting
    if (leftData && rightData) {
        prepareAnnotationsEnhanced();
        if (pdfDocLeft) drawAllAnnotationsForSide('left');
        if (pdfDocRight) drawAllAnnotationsForSide('right');
    }
}

// Update the comparison function to show PDF section
const originalRenderDiff = renderDiff;
renderDiff = function (paragraphDiffs) {
    originalRenderDiff(paragraphDiffs);
    showPDFSection();
};

// Initialize zoom display
zoomLevelSpan.textContent = Math.round(zoomLevel * 100) + '%';

// ===== Synchronized Scrolling (Phase 3) =====

// Sync scroll state
let syncScrollEnabled = true;
let syncScrollMode = 'percentage'; // 'percentage' or 'anchor'
let isSyncing = false; // Prevent recursive sync

/**
 * Get PDF viewer scroll containers
 */
const pdfViewerLeft = document.getElementById('pdf-viewer-left');
const pdfViewerRight = document.getElementById('pdf-viewer-right');

/**
 * Get diff panel scroll containers
 */
const diffPanelLeft = document.getElementById('diff-left');
const diffPanelRight = document.getElementById('diff-right');

/**
 * Setup synchronized scrolling for PDF viewers
 */
function setupSyncScroll() {
    if (!pdfViewerLeft || !pdfViewerRight) return;

    // PDF viewer sync
    pdfViewerLeft.addEventListener('scroll', () => {
        if (!syncScrollEnabled || isSyncing) return;
        syncScroll(pdfViewerLeft, pdfViewerRight);
    });

    pdfViewerRight.addEventListener('scroll', () => {
        if (!syncScrollEnabled || isSyncing) return;
        syncScroll(pdfViewerRight, pdfViewerLeft);
    });

    // Diff panel sync
    if (diffPanelLeft && diffPanelRight) {
        diffPanelLeft.addEventListener('scroll', () => {
            if (!syncScrollEnabled || isSyncing) return;
            syncScroll(diffPanelLeft, diffPanelRight);
        });

        diffPanelRight.addEventListener('scroll', () => {
            if (!syncScrollEnabled || isSyncing) return;
            syncScroll(diffPanelRight, diffPanelLeft);
        });
    }
}

/**
 * Sync scroll between two elements
 * @param {HTMLElement} source - Source element
 * @param {HTMLElement} target - Target element
 */
function syncScroll(source, target) {
    isSyncing = true;

    if (syncScrollMode === 'percentage') {
        // Percentage-based sync
        const scrollPercentage = source.scrollTop / (source.scrollHeight - source.clientHeight);
        const targetScrollTop = scrollPercentage * (target.scrollHeight - target.clientHeight);

        if (!isNaN(targetScrollTop) && isFinite(targetScrollTop)) {
            target.scrollTop = targetScrollTop;
        }
    } else if (syncScrollMode === 'anchor') {
        // Anchor-based sync (find matching paragraph)
        syncScrollByAnchor(source, target);
    }

    // Reset syncing flag after a short delay
    setTimeout(() => {
        isSyncing = false;
    }, 50);
}

/**
 * Anchor-based scroll sync
 * Find the top-visible element and scroll to matching element on other side
 * Supports: .diff-paragraph, .docx-paragraph, .pdf-page-wrapper
 */
function syncScrollByAnchor(source, target) {
    // Determine which type of elements to look for
    const sourceSelector = getScrollableElementSelector(source);
    const targetSelector = getScrollableElementSelector(target);

    // If element types are incompatible (PDF pages vs DOCX paragraphs),
    // use percentage-based sync instead
    const isSourcePdf = sourceSelector === '.pdf-page-wrapper';
    const isTargetPdf = targetSelector === '.pdf-page-wrapper';
    const isSourceDocx = sourceSelector === '.docx-paragraph';
    const isTargetDocx = targetSelector === '.docx-paragraph';

    // Mixed PDF/DOCX: use percentage-based sync
    if ((isSourcePdf && isTargetDocx) || (isSourceDocx && isTargetPdf)) {
        syncScrollByPercentage(source, target);
        return;
    }

    const sourceElements = source.querySelectorAll(sourceSelector);
    if (sourceElements.length === 0) {
        // Fallback to percentage if no elements found
        syncScrollByPercentage(source, target);
        return;
    }

    // Find the first visible element
    const sourceRect = source.getBoundingClientRect();
    let topElement = null;
    let topElementOffset = 0;

    for (const el of sourceElements) {
        const elRect = el.getBoundingClientRect();
        if (elRect.top >= sourceRect.top - 10) {
            topElement = el;
            // Calculate offset from container top
            topElementOffset = elRect.top - sourceRect.top;
            break;
        }
    }

    if (!topElement) {
        syncScrollByPercentage(source, target);
        return;
    }

    // Get element index (use data-paragraph-idx if available, otherwise array index)
    let elementIndex;
    if (topElement.hasAttribute('data-paragraph-idx')) {
        elementIndex = parseInt(topElement.getAttribute('data-paragraph-idx'));
    } else {
        elementIndex = Array.from(sourceElements).indexOf(topElement);
    }

    // Find corresponding element in target
    const targetElements = target.querySelectorAll(targetSelector);

    if (targetElements.length === 0) {
        syncScrollByPercentage(source, target);
        return;
    }

    // For same-type elements, use direct index mapping
    // For different counts, use ratio
    const sourceTotal = sourceElements.length;
    const targetTotal = targetElements.length;

    let targetIndex;
    if (sourceTotal === targetTotal) {
        // Same count: direct mapping
        targetIndex = elementIndex;
    } else {
        // Different count: ratio mapping
        targetIndex = Math.min(
            Math.floor((elementIndex / sourceTotal) * targetTotal),
            targetTotal - 1
        );
    }

    if (targetIndex >= 0 && targetIndex < targetElements.length) {
        const targetElement = targetElements[targetIndex];
        // Calculate scroll position
        const targetElementTop = targetElement.offsetTop - target.offsetTop;
        target.scrollTop = Math.max(0, targetElementTop - topElementOffset);
    }
}

/**
 * Percentage-based scroll sync helper
 */
function syncScrollByPercentage(source, target) {
    const scrollPercentage = source.scrollTop / (source.scrollHeight - source.clientHeight);
    const targetScrollTop = scrollPercentage * (target.scrollHeight - target.clientHeight);

    if (!isNaN(targetScrollTop) && isFinite(targetScrollTop)) {
        target.scrollTop = targetScrollTop;
    }
}

/**
 * Get the CSS selector for scrollable elements in a container
 */
function getScrollableElementSelector(container) {
    // Check what type of content is in the container
    if (container.querySelector('.docx-paragraph')) {
        return '.docx-paragraph';
    } else if (container.querySelector('.pdf-page-wrapper')) {
        return '.pdf-page-wrapper';
    } else if (container.querySelector('.diff-paragraph')) {
        return '.diff-paragraph';
    }
    // Fallback
    return '.diff-paragraph';
}

/**
 * Toggle sync scroll on/off
 */
function toggleSyncScroll() {
    syncScrollEnabled = !syncScrollEnabled;
    updateSyncScrollUI();
}

/**
 * Set sync scroll mode
 * @param {string} mode - 'percentage' or 'anchor'
 */
function setSyncScrollMode(mode) {
    syncScrollMode = mode;
    updateSyncScrollUI();
}

/**
 * Update sync scroll UI state
 */
function updateSyncScrollUI() {
    const toggleBtn = document.getElementById('sync-scroll-toggle');
    const modeSelect = document.getElementById('sync-scroll-mode');

    if (toggleBtn) {
        toggleBtn.classList.toggle('active', syncScrollEnabled);
        toggleBtn.textContent = syncScrollEnabled ? '同步滚动: 开' : '同步滚动: 关';
    }

    if (modeSelect) {
        modeSelect.value = syncScrollMode;
    }
}

// Initialize sync scroll
document.addEventListener('DOMContentLoaded', () => {
    setupSyncScroll();
});

// Also setup immediately in case DOM is already loaded
if (document.readyState !== 'loading') {
    setupSyncScroll();
}

