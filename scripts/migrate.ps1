param(
    [switch]$Execute,
    [switch]$AllowDangerousHistory
)

$Runner = Join-Path $PSScriptRoot "migrate.mjs"
$Arguments = @($Runner)
if ($Execute) { $Arguments += "--execute" }
if ($AllowDangerousHistory) { $Arguments += "--allow-dangerous-history" }

& node @Arguments
exit $LASTEXITCODE
