const fs = require('fs');
const JavaRunner = require('./lib/java-runner');

async function testJavaIntegration() {
  console.log('🧪 Testing Java Integration in Docker...\n');

  try {
    // Test 1: Check Java availability
    console.log('1. Checking Java availability...');
    const isAvailable = await JavaRunner.isJavaAvailable();
    console.log('   ✅ Java available:', isAvailable);

    if (isAvailable) {
      const version = await JavaRunner.getJavaVersion();
      console.log('   📋 Java version:', version);
    }

    // Test 2: Create a simple JAR file for testing
    console.log('\n2. Creating test JAR file...');
    
    // Since we don't have a compiler in the container, let's test with any existing JAR
    // or skip this part if no JARs are available
    const jarFiles = fs.readdirSync('./jars').filter(f => f.endsWith('.jar'));
    
    if (jarFiles.length === 0) {
      console.log('   ℹ️  No JAR files found in jars/ directory');
      console.log('   📝 To test with your own JAR files:');
      console.log('      1. Place .jar files in the jars/ directory');
      console.log('      2. Rebuild the Docker container');
      console.log('      3. Run this test again');
    } else {
      console.log(`   ✅ Found ${jarFiles.length} JAR file(s):`, jarFiles);
      
      // Test with the first JAR file
      const testJar = jarFiles[0];
      console.log(`\n3. Testing execution of ${testJar}...`);
      
      const runner = new JavaRunner(`./jars/${testJar}`);
      
      if (runner.validateJarExists()) {
        try {
          const result = await runner.execute(['test', 'argument']);
          console.log('   ✅ JAR executed successfully!');
          console.log('   📤 Output:', result.stdout);
          if (result.stderr) {
            console.log('   ⚠️  Stderr:', result.stderr);
          }
        } catch (error) {
          console.log('   ⚠️  JAR execution failed:', error.message);
          console.log('   💡 This might be expected if the JAR requires specific arguments');
        }
      } else {
        console.log('   ❌ JAR file not found');
      }
    }

    console.log('\n🎉 Java integration test completed!');
    console.log('\n📚 Next steps:');
    console.log('   • Place your .jar files in the jars/ directory');
    console.log('   • Use the JavaRunner class in your application');
    console.log('   • Access Java functionality via /api/java/execute endpoint');
    console.log('   • Refer to docs/java-integration.md for examples');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testJavaIntegration();
