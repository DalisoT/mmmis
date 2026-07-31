# tools/supabase.ps1
#
# Tiny wrapper that calls the Supabase CLI binary that's been cached by
# npx under the user's %LOCALAPPDATA%. The wrapper invokes the proper
# .exe directly so we bypass the npx/supabase.js host-detection bug on
# Windows ("No matching Supabase CLI binary package found for win32-x64").
#
# Usage from PowerShell:
#   .\tools\supabase.ps1 login
#   .\tools\supabase.ps1 link --project-ref <ref>
#   .\tools\supabase.ps1 functions deploy push-dispatch --no-verify-jwt
#
# If your machine has the binary elsewhere, edit $SupabaseExe below.

param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args
)

$SupabaseExe = "$env:LOCALAPPDATA\npm-cache\_npx\aa8e5c70f9d8d161\node_modules\supabase\bin\supabase.exe"

if (-not (Test-Path $SupabaseExe)) {
    Write-Host "Supabase CLI not found at $SupabaseExe" -ForegroundColor Red
    Write-Host "Try: npx --yes supabase --version  (this will repopulate the cache)" -ForegroundColor Yellow
    exit 1
}

& $SupabaseExe @Args
exit $LASTEXITCODE
