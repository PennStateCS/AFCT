# PowerShell script to update NextAuth v4 to v5 patterns
$files = Get-ChildItem -Path "src" -Recurse -Include "*.ts", "*.tsx"

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -and $content -match "getServerSession") {
        Write-Host "Updating file: $($file.FullName)"
        
        # Replace imports
        $content = $content -replace "import { getServerSession } from 'next-auth';", ""
        $content = $content -replace "import { authOptions } from '@/lib/authOptions';", ""
        
        # Add new import if not already present
        if ($content -notmatch "import { auth } from '@/lib/auth';") {
            # Find the first import line and add after it
            $content = $content -replace "(import[^;]+;)", "`$1`nimport { auth } from '@/lib/auth';"
        }
        
        # Replace function calls
        $content = $content -replace "getServerSession\(authOptions\)", "auth()"
        
        # Clean up multiple newlines
        $content = $content -replace "`n`n`n+", "`n`n"
        
        # Write back to file
        $content | Set-Content $file.FullName -NoNewline
    }
}

Write-Host "NextAuth v5 migration completed!"
