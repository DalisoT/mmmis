param(
    [switch]$Execute,
    [switch]$IncludeDestructive,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Functions
)

$Runner = Join-Path $PSScriptRoot "deploy-functions.mjs"
$Arguments = @($Runner) + $Functions
if ($Execute) { $Arguments += "--execute" }
if ($IncludeDestructive) { $Arguments += "--include-destructive" }

& node @Arguments
exit $LASTEXITCODE
