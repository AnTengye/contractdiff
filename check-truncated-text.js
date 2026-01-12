// Script to check if backend returned complete text for the truncated paragraph
// Run with: node check-truncated-text.js

const contractIds = [
  '317e85b4-be79-460a-8b93-b95a3881051d',
  '495d2807-bb78-4f71-aab3-6c3ab673ea64'
];
const backendUrl = 'http://127.0.0.1:18080';

async function fetchContractData(contractId) {
  try {
    const response = await fetch(`${backendUrl}/api/contracts/${contractId}/data`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch contract ${contractId}:`, error.message);
    return null;
  }
}

async function checkTruncatedText() {
  console.log('=== Checking Truncated Text ===\n');
  
  // The text that appears to be truncated
  const searchText = '乙方展示地图有产生负';
  const alternativeSearch = '展示地图';
  
  for (const contractId of contractIds) {
    console.log(`\n--- Contract: ${contractId} ---`);
    
    const data = await fetchContractData(contractId);
    if (!data || !data.paragraphs) {
      console.log('❌ No data or paragraphs found');
      continue;
    }
    
    console.log(`✓ Total paragraphs: ${data.paragraphs.length}\n`);
    
    // Search for the truncated text
    let found = false;
    
    data.paragraphs.forEach((para, index) => {
      const text = para.text || '';
      
      // Check if this paragraph contains the search text
      if (text.includes(searchText) || text.includes(alternativeSearch)) {
        found = true;
        console.log(`\n✓ Found in paragraph ${index} (page ${para.page}):`);
        console.log(`\nType: ${para.type}`);
        console.log(`\nFull text (${text.length} characters):`);
        console.log(text);
        console.log('\n' + '='.repeat(80));
        
        // Check if text seems truncated (ends abruptly)
        const lastChars = text.slice(-20);
        console.log(`\nLast 20 characters: "${lastChars}"`);
        
        if (!text.endsWith('。') && !text.endsWith('！') && !text.endsWith('？')) {
          console.log('⚠️  WARNING: Text does not end with proper punctuation - might be truncated!');
        } else {
          console.log('✓ Text ends with proper punctuation');
        }
        
        // Check the next paragraph
        if (index + 1 < data.paragraphs.length) {
          const nextPara = data.paragraphs[index + 1];
          console.log(`\n--- Next paragraph (${index + 1}) ---`);
          console.log(`Type: ${nextPara.type}`);
          console.log(`Text preview: ${(nextPara.text || '').substring(0, 100)}...`);
        }
      }
    });
    
    if (!found) {
      console.log(`\n❌ Text "${searchText}" not found in this contract`);
      
      // Try to find similar text
      console.log('\nSearching for similar patterns...');
      data.paragraphs.forEach((para, index) => {
        const text = para.text || '';
        if (text.includes('地图') || text.includes('负')) {
          console.log(`\nParagraph ${index}: ${text.substring(0, 100)}...`);
        }
      });
    }
  }
}

// Run the check
checkTruncatedText().catch(console.error);
