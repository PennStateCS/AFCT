const fs = require('fs');
const path = require('path');

// List of files that still need updating based on our grep search
const filesToUpdate = [
  'src/app/api/courses/[id]/route.ts',
  'src/app/api/courses/[id]/problems/route.ts',
  'src/app/api/assignments/[id]/problems/route.ts',
  'src/app/api/courses/[id]/[aid]/remove-problem/route.ts',
  'src/app/api/courses/[id]/[aid]/add-problems/route.ts',
  'src/app/api/courses/[id]/problems/[pid]/route.ts',
  'src/app/api/courses/[id]/[aid]/submissions/[sid]/route.ts'
];

function updateFile(filePath) {
  try {
    const fullPath = path.join(__dirname, filePath);
    let content = fs.readFileSync(fullPath, 'utf8');
    
    // Add import if not present
    if (!content.includes('createEnhancedActivityLog') && content.includes('prisma.activityLog.create')) {
      // Find the imports section and add our import
      const importLines = content.split('\n').filter(line => line.trim().startsWith('import'));
      const lastImportIndex = content.lastIndexOf(importLines[importLines.length - 1]);
      const insertPosition = content.indexOf('\n', lastImportIndex) + 1;
      content = content.slice(0, insertPosition) + 
                "import { createEnhancedActivityLog } from '@/lib/activity-log-utils';\n" +
                content.slice(insertPosition);
    }
    
    // Replace old ActivityLog calls with new enhanced version
    content = content.replace(
      /await prisma\.activityLog\.create\(\s*{\s*data:\s*{\s*userId:\s*([^,]+),\s*action:\s*([^,]+),\s*metadata:\s*({[^}]*})[^}]*}\s*}\s*\);/gs,
      (match, userId, action, metadata) => {
        // Clean up the metadata to remove IP and userAgent
        let cleanMetadata = metadata.replace(/,?\s*ipAddress:\s*[^,}]+/g, '');
        cleanMetadata = cleanMetadata.replace(/,?\s*userAgent:\s*[^,}]+/g, '');
        cleanMetadata = cleanMetadata.replace(/,\s*}/g, '}');
        
        return `await createEnhancedActivityLog(prisma, req, {
      userId: ${userId},
      action: ${action},
      category: 'SYSTEM', // Will be auto-categorized
      metadata: ${cleanMetadata},
    });`;
      }
    );
    
    // Remove IP extraction code if it exists
    content = content.replace(
      /const ip =\s*req\.headers\.get\([^;]+;\s*/g, ''
    );
    content = content.replace(
      /const userAgent =\s*req\.headers\.get\([^;]+;\s*/g, ''
    );
    
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`✓ Updated ${filePath}`);
    
  } catch (error) {
    console.error(`✗ Error updating ${filePath}:`, error.message);
  }
}

console.log('Updating remaining API endpoints...');
filesToUpdate.forEach(updateFile);
console.log('Done!');
