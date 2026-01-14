
const { shouldMergeParagraphs, mergeCrossPageParagraphs } = require('./json-test-utils.cjs');

// Mock data
const p1 = { text: "对本合同的影响程度及相关", pageIdx: 3 };
const p2 = { text: "第 4 页", pageIdx: 4 };
const p3 = { text: "的官方证明文件(如有).", pageIdx: 4 };

console.log("Test 1: Merge p1 and p2");
const merge1 = shouldMergeParagraphs(p1, p2);
console.log(`Should merge "${p1.text}" and "${p2.text}"? ${merge1}`);

console.log("\nTest 2: Merge (p1+p2) and p3");
const p1_2 = { text: p1.text + p2.text, pageIdx: 3 };
const merge2 = shouldMergeParagraphs(p1_2, p3);
console.log(`Should merge "${p1_2.text}" and "${p3.text}"? ${merge2}`);

// Test full merge
const paragraphs = [p1, p2, p3];
console.log("\nTest 3: Full merge");
const merged = mergeCrossPageParagraphs(paragraphs);
console.log("Merged result:", JSON.stringify(merged, null, 2));

// Test with page number pattern check
const sectionPattern = /^第[一二三四五六七八九十\d]+[条章节款项]\s*/;
console.log("\nPattern Check:");
console.log(`"第 4 页" matches pattern? ${sectionPattern.test("第 4 页")}`);
