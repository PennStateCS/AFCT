const JavaRunner = require('./lib/java-runner');

async function testAfctEvaluator() {
  console.log('🧪 Testing AFCT Evaluator JAR...\n');

  try {
    // Test 1: Show help
    console.log('1. Testing help command...');
    const runner = new JavaRunner('./jars/afct-evaluator.jar');
    
    const helpResult = await runner.execute(['--help']);
    console.log('   ✅ Help output:');
    console.log('   ' + helpResult.stdout.split('\n').join('\n   '));

    // Test 2: Show JSON format
    console.log('\n2. Testing JSON output format...');
    const jsonHelp = await runner.execute(['--json', '--help']);
    console.log('   ✅ JSON Help output:');
    console.log('   ' + jsonHelp.stdout.split('\n').join('\n   '));

    console.log('\n🎉 AFCT Evaluator is ready to use!');
    console.log('\n📚 Usage in your application:');
    console.log('   const runner = new JavaRunner("./jars/afct-evaluator.jar");');
    console.log('   const result = await runner.execute([');
    console.log('     "answer.txt",      // Answer file path');
    console.log('     "submission.txt",  // Submission file path');
    console.log('     "10",              // Max states (optional)');
    console.log('     "true"             // Deterministic (optional)');
    console.log('   ]);');
    console.log('   console.log(result.stdout);');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testAfctEvaluator();
