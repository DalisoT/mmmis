# Run the admin-wipe-auth-users Edge Function.
# Usage: .\tools\run_wipe.ps1 -Secret <64-hex>
param(
  [Parameter(Mandatory = $true)][string]$Secret
)

$env:SUPABASE_URL = "https://gkegnmshivmgqhenqkzr.supabase.co"
$headers = @{
  "X-Admin-Secret" = $Secret
  "Content-Type"   = "application/json"
}
$uri = "$env:SUPABASE_URL/functions/v1/admin-wipe-auth-users"

try {
  $resp = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -TimeoutSec 60
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