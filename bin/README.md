# Binary Dependencies for AFCT Evaluator

The `afct-evaluator.jar` requires a binary dependency that should be placed in this directory.

## Required Binary

**Name:** `cfganalyzer` (or the specific name your JAR expects)
**Path:** This file should be placed at `/app/bin/cfganalyzer` inside the Docker container

## Setup Instructions

### Option 1: Add Your Binary File
1. Place your binary file in this `bin/` directory
2. Rename it to `cfganalyzer` (or update the environment variable)
3. Rebuild the Docker container

### Option 2: Build Binary from Source (if applicable)
If you have source code for the binary:
1. Add build instructions to the Dockerfile
2. Compile the binary during Docker build
3. Place it in `/app/bin/`

### Option 3: Download Binary During Build
If the binary is available for download:
1. Add download commands to the Dockerfile
2. Extract and place in `/app/bin/`

## Environment Variables

The following environment variables control the binary:

- `CFGANALYZER_BINARY`: Path to the binary (default: `/app/bin/cfganalyzer`)
- `CFGANALYZER_LIMIT`: Processing limit (default: `15`)

## Current Status

⚠️  **Binary Missing**: The `cfganalyzer` binary is not currently installed.

The JAR will show warnings about the missing binary until you:
1. Place the binary file in this directory
2. Rebuild the Docker container

## Testing

After adding the binary, test with:

```bash
# Test that the binary exists and is executable
docker exec afct-app-1 ls -la /app/bin/
docker exec afct-app-1 /app/bin/cfganalyzer --help

# Test the JAR with the binary
docker exec afct-app-1 java -jar /app/jars/afct-evaluator.jar answer.txt submission.txt
```

## Troubleshooting

### Permission Issues
If you get permission errors:
```bash
docker exec afct-app-1 chmod +x /app/bin/cfganalyzer
```

### Path Issues
Verify the environment variable:
```bash
docker exec afct-app-1 env | grep CFGANALYZER
```

### Binary Compatibility
Ensure the binary is compatible with Alpine Linux (musl libc).
