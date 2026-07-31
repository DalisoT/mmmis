# One-shot helper to promote a user to administrator via bootstrap-admin EF.
# Usage: powershell -ExecutionPolicy Bypass -File tools/run_bootstrap.ps1 -Email someone@example.com -Secret <value>

param(
  [Parameter(Mandatory = $true)][string]$Email,
  [Parameter(Mandatory = $true)][string]$Secret
)

$ErrorActionPreference = "Stop"
$env:SUPABASE_URL = "https://gkegnmshivmgqhenqkzr.supabase.co"
$uri = "$env:SUPABASE_URL/functions/v1/bootstrap-admin"
$headers = @{
  "X-Bootstrap-Secret" = $Secret
  "Content-Type"       = "application/json"
}
$body = @{ email = $Email } | ConvertTo-Json

try {
  $resp = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body -TimeoutSec 60
  $resp | ConvertTo-Json -Depth 5
} catch {
  Write-Host "HTTP error:" -ForegroundColor Red
  Write-Host $_.Exception.Message
  if ($_.Exception.Response) {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    Write-Host "Body:" -ForegroundColor Red
    Write-Host $reader.ReadToEnd()
  }
  exit 1
}