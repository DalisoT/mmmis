# One-shot helper to create the first admin's auth.users row via the CLI.
# Run from project root:  powershell -ExecutionPolicy Bypass -File tools/bootstrap_admin_create_user.ps1

$ErrorActionPreference = "Stop"

$supabaseExe = "C:\Users\PATRICIA\AppData\Local\npm-cache\_npx\aa8e5c70f9d8d161\node_modules\supabase\bin\supabase.exe"
if (-not (Test-Path $supabaseExe)) {
  Write-Host "supabase.exe not found at $supabaseExe" -ForegroundColor Red
  Write-Host "Run 'npx supabase --version' once to populate the npx cache, then retry." -ForegroundColor Yellow
  exit 1
}

$email    = "datemric@gmail.com"
$password = "MyStrongPass123!"   # change if you want something else

Write-Host "Creating auth.users row for $email ..." -ForegroundColor Cyan
& $supabaseExe auth users create $email --password $password --email-confirm
if ($LASTEXITCODE -ne 0) {
  Write-Host "CLI exited with code $LASTEXITCODE" -ForegroundColor Red
  exit $LASTEXITCODE
}
Write-Host ""
Write-Host "Copy the 'id' field from the JSON above, then run the SQL block from CONTINUE_HERE.md:" -ForegroundColor Green
Write-Host "  insert into public.users ... ; insert into public.members ... ;" -ForegroundColor Green
Write-Host "Then run the bootstrap-admin curl, then:  supabase secrets unset BOOTSTRAP_SECRET" -ForegroundColor Green