// Test script to compare the two contracts and analyze the results
// Run with: node test-comparison.js

const contractLeft = '317e85b4-be79-460a-8b93-b95a3881051d';
const contractRight = '495d2807-bb78-4f71-aab3-6c3ab673ea64';
const backendUrl = 'http://127.0.0.1:18080';

async function fetchContractData(contractId) {
  const response = await fetch(`${backendUrl}/api/contracts/${contractId}/data`);
  if (!response.ok) {
    throw new Error(`Failed to fetch contract ${contractId}: ${response.statusText}`);
  }
  return await response.json();
}

async function testComparison() {
  console.log('=== Contract Comparison Test ===\n');
  
  try {
    console.log('Fetching left contract data...');
    const leftData = await fetchContractData(contractLeft);
    console.log(`✓ Left contract: ${leftData.paragraphs?.length || 0} paragraphs\n`);
    
    console.log('Fetching right contract data...');
    const rightData = await fetchContractData(contractRight);
    console.log(`✓ Right contract: ${rightData.paragraphs?.length || 0} paragraphs\n`);
    
    // Check for the problematic text
    console.log('=== Searching for problematic paragraph ===');
    const searchText = '甲方收到乙方支付';
    
    console.log('\nLeft contract paragraphs containing "甲方收到乙方支付":');
    leftData.paragraphs?.forEach((para, index) => {
      if (para.text?.includes(searchText)) {
        console.log(`\nParagraph ${index} (page ${para.page}):`);
        console.log(`Text: ${para.text.substring(0, 150)}...`);
        console.log(`Type: ${para.type}`);
        console.log(`Has bbox: ${!!para.bbox}`);
        console.log(`Has lines: ${!!para.lines}`);
      }
    });
    
    console.log('\n\nRight contract paragraphs containing "甲方收到乙方支付":');
    rightData.paragraphs?.forEach((para, index) => {
      if (para.text?.includes(searchText)) {
        console.log(`\nParagraph ${index} (page ${para.page}):`);
        console.log(`Text: ${para.text.substring(0, 150)}...`);
        console.log(`Type: ${para.type}`);
        console.log(`Has bbox: ${!!para.bbox}`);
        console.log(`Has lines: ${!!para.lines}`);
      }
    });
    
    // Check for strange characters
    console.log('\n\n=== Checking for unusual characters ===');
    rightData.paragraphs?.forEach((para, index) => {
      if (para.text?.includes('[') || para.text?.includes('\\')) {
        console.log(`\nParagraph ${index}: Found special characters`);
        console.log(`Text: ${para.text}`);
      }
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('\nMake sure:');
    console.error('1. Backend is running on http://127.0.0.1:18080');
    console.error('2. Contracts exist in the database');
  }
}

testComparison();
