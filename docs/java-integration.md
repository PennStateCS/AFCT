# Java Integration in Docker

This project now supports running Java .jar files within the Docker containers.

## Java Runtime

Both development and production Docker images include:
- **OpenJDK 11 JRE** (Java Runtime Environment)
- Full support for executing .jar files

## Directory Structure

```
/app
├── jars/           # Place your .jar files here
├── lib/
│   └── java-runner.js  # Java execution utility
└── src/app/api/java/
    └── execute/
        └── route.ts    # API endpoint for Java execution
```

## Usage Examples

### 1. Using the JavaRunner Class Directly

```javascript
const JavaRunner = require('./lib/java-runner');

// Create a runner for your JAR file
const runner = new JavaRunner('./jars/my-app.jar');

// Execute with arguments
const result = await runner.execute(['arg1', 'arg2']);
console.log('Output:', result.stdout);
```

### 2. Using the API Endpoint

```bash
# Check Java status
curl http://localhost:3000/api/java/execute

# Execute a JAR file
curl -X POST http://localhost:3000/api/java/execute \
  -H "Content-Type: application/json" \
  -d '{
    "jarFile": "my-app.jar",
    "args": ["--input", "data.txt"],
    "input": "some input data"
  }'
```

### 3. From Your Next.js Components

```typescript
// Check if Java is available
const checkJava = async () => {
  const response = await fetch('/api/java/execute');
  const data = await response.json();
  console.log('Java available:', data.javaAvailable);
  console.log('Java version:', data.javaVersion);
};

// Execute a JAR file
const runJavaApp = async () => {
  const response = await fetch('/api/java/execute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jarFile: 'my-algorithm.jar',
      args: ['--mode', 'analyze'],
      input: 'sample input data'
    })
  });
  
  const result = await response.json();
  if (result.success) {
    console.log('Java output:', result.stdout);
  } else {
    console.error('Java error:', result.error);
  }
};
```

## Adding Your JAR Files

1. **Development**: Place JAR files in the `jars/` directory
2. **Docker**: The `jars/` directory is included in the Docker build

### Example JAR File Structure
```
jars/
├── algorithm-solver.jar
├── data-processor.jar
└── utility-tools.jar
```

## Environment Variables

You can configure Java execution via environment variables:

```env
# Optional: Custom Java path (defaults to 'java')
JAVA_PATH=/usr/bin/java

# Optional: Default JVM arguments
JAVA_OPTS=-Xmx512m -Xms256m

# AFCT Evaluator specific variables
CFGANALYZER_LIMIT=15
CFGANALYZER_BINARY=/app/bin/cfganalyzer
```

### AFCT Evaluator Configuration

The `afct-evaluator.jar` requires specific environment variables:

- **CFGANALYZER_LIMIT**: Processing limit (default: 15)
- **CFGANALYZER_BINARY**: Path to the CFG analyzer binary dependency

⚠️ **Important**: The `afct-evaluator.jar` depends on a binary file that must be placed in the `bin/` directory. See `bin/README.md` for setup instructions.

## Docker Build Notes

- Java is installed during the Docker build process
- No additional configuration needed
- Works in both development and production containers
- Lightweight OpenJDK 11 JRE (no compilation tools)

## Troubleshooting

### Check Java Installation
```bash
# Inside Docker container
docker exec -it <container-name> java -version
```

### Debug JAR Execution
```bash
# Test JAR manually in container
docker exec -it <container-name> java -jar /app/jars/your-app.jar --help
```

### Common Issues

1. **JAR not found**: Ensure the .jar file is in the `jars/` directory
2. **Permission denied**: Make sure JAR files have proper permissions
3. **Out of memory**: Add JVM memory flags: `-Xmx1g -Xms512m`

## Advanced Usage

### Custom Java Options
```javascript
const runner = new JavaRunner('./jars/memory-intensive.jar', {
  defaultArgs: ['-Xmx2g', '-Xms1g']
});
```

### Streaming Output (for long-running processes)
```javascript
const process = runner.executeStream(['--process-large-file'], {
  onStdout: (data) => console.log('Progress:', data.toString()),
  onStderr: (data) => console.error('Error:', data.toString()),
  onClose: (code) => console.log('Finished with code:', code)
});
```
