# This file sets up the environment variables for development
# For linux users run the following in your terminal: export $(grep -v '^#' [yourEnvFile])

# Get the path and content of working .env file
$env_path = "PATH_HERE" # Replace this path your your path to your designated env file
$env_content = Get-Content $env_path

# Iterate though each line in env
foreach ($line in $env_content) {
    # Skip comments, which start with a pound symbol
    if (-not $line.StartsWith('#')) {
        # Get the variable (left of equal) and value (right of equal)
        $parts = $line -split '=', 2 # Split the current line into two parts separated by an equal sign
        if ($parts.Count -eq 2) {
            $variable = $parts[0].Trim()
            $value = $parts[1].Trim().Trim('"') # Remove any surrounding quotes from the value
        }

        # Set the environment variable in your PowerShell session
        if ($variable -and $value) {
            [System.Environment]::SetEnvironmentVariable($variable, $value, [System.EnvironmentVariableTarget]::Process)
        }
    }
}
