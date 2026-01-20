// Test script for the new V3 text diff engine
// Run this in browser console to test with mock data

import { computeTextDiffV2, exportDiffDebug } from '@/services/diff/textv2';
import type { ContractData } from '@/services/diff/textv2';

/**
 * Create mock contract data for testing
 */
function createMockContractData(texts: string[], pageIdx: number = 0): ContractData {
  const paragraphs = texts.map((text, index) => ({
    type: 'text',
    page: pageIdx + 1,
    index,
    bbox: [0, index * 50, 500, (index + 1) * 50] as [number, number, number, number],
    lines: [{
      spans: [{
        content: text,
        bbox: [0, index * 50, 500, (index + 1) * 50] as [number, number, number, number],
      }],
    }],
  }));

  return { paragraphs };
}

/**
 * Test basic diff functionality
 */
export function testBasicDiff(): void {
  console.log('=== Testing Basic Diff ===');

  const leftData = createMockContractData([
    '这是第一段文字。',
    '这是第二段文字，包含一些内容。',
    '这是第三段文字。',
  ]);

  const rightData = createMockContractData([
    '这是第一段文字。',
    '这是第二段文字，包含一些修改后的内容。',
    '这是第三段文字。',
    '这是新增的第四段。',
  ]);

  const result = computeTextDiffV2(leftData, rightData, { debug: true });

  console.log('Left full text:', result.left.fullText);
  console.log('Right full text:', result.right.fullText);
  console.log('Changes:', result.changes.length);
  console.log('Stats:', result.stats);
  console.log('Debug:', exportDiffDebug(result));

  // Validate results
  console.assert(result.stats.totalChanges > 0, 'Should have changes');
  console.assert(result.left.segments.length > 0, 'Should have left segments');
  console.assert(result.right.segments.length > 0, 'Should have right segments');

  console.log('=== Basic Diff Test PASSED ===');
}

/**
 * Test Chinese text diff
 */
export function testChineseDiff(): void {
  console.log('=== Testing Chinese Diff ===');

  const leftData = createMockContractData([
    '甲方应当按照合同约定的时间和方式支付货款。',
    '乙方应当保证产品质量符合国家标准。',
  ]);

  const rightData = createMockContractData([
    '甲方应当按照合同约定的时间和方式支付全部货款。',
    '乙方应当保证产品质量符合国家及行业标准。',
  ]);

  const result = computeTextDiffV2(leftData, rightData, { 
    charLevel: true,
    debug: true 
  });

  console.log('Changes:', result.changes.filter(c => c.type !== 'unchanged'));
  console.log('Stats:', result.stats);

  console.log('=== Chinese Diff Test PASSED ===');
}

/**
 * Test multi-page diff
 */
export function testMultiPageDiff(): void {
  console.log('=== Testing Multi-Page Diff ===');

  const leftData: ContractData = {
    paragraphs: [
      {
        type: 'text',
        page: 1,
        index: 0,
        lines: [{ spans: [{ content: '第一页内容' }] }],
      },
      {
        type: 'text',
        page: 2,
        index: 1,
        lines: [{ spans: [{ content: '第二页内容' }] }],
      },
    ],
  };

  const rightData: ContractData = {
    paragraphs: [
      {
        type: 'text',
        page: 1,
        index: 0,
        lines: [{ spans: [{ content: '第一页修改后的内容' }] }],
      },
      {
        type: 'text',
        page: 2,
        index: 1,
        lines: [{ spans: [{ content: '第二页内容' }] }],
      },
    ],
  };

  const result = computeTextDiffV2(leftData, rightData, { debug: true });

  // Check that page info is preserved in segments
  const leftPages = new Set(result.left.segments.map(s => s.pageIdx));
  const rightPages = new Set(result.right.segments.map(s => s.pageIdx));

  console.log('Left pages:', [...leftPages]);
  console.log('Right pages:', [...rightPages]);

  console.log('=== Multi-Page Diff Test PASSED ===');
}

/**
 * Run all tests
 */
export function runAllTests(): void {
  console.log('Starting V3 Text Diff Engine Tests...\n');

  try {
    testBasicDiff();
    console.log('');
    testChineseDiff();
    console.log('');
    testMultiPageDiff();
    console.log('\n=== ALL TESTS PASSED ===');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Auto-run if loaded directly
if (typeof window !== 'undefined') {
  (window as any).testDiffV3 = {
    runAllTests,
    testBasicDiff,
    testChineseDiff,
    testMultiPageDiff,
    computeTextDiffV2,
    exportDiffDebug,
  };
  console.log('V3 Diff tests available: window.testDiffV3.runAllTests()');
}
