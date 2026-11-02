param(
  [string]$EnvPath = '.env.local'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$resolvedEnv = [System.IO.Path]::GetFullPath(
  (Join-Path $projectRoot $EnvPath)
)

if (-not (Test-Path -LiteralPath $resolvedEnv)) {
  throw "No se encontro el entorno propio del microservicio: $resolvedEnv. Copie .env.local.example como .env.local."
}

foreach ($line in Get-Content -LiteralPath $resolvedEnv) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
  $separator = $trimmed.IndexOf('=')
  if ($separator -lt 1) { continue }
  $name = $trimmed.Substring(0, $separator).Trim()
  $value = $trimmed.Substring($separator + 1).Trim().Trim('"').Trim("'")
  if ($name -notmatch '^[A-Z][A-Z0-9_]*$') { continue }
  if (-not [Environment]::GetEnvironmentVariable($name)) {
    Set-Item -Path "Env:$name" -Value $value
  }
}

$required = @(
  'DATABASE_URL',
  'SECRETS_ENCRYPTION_KEY',
  'API_KEY_PEPPER',
  'PLATFORM_ADMIN_KEY',
  'CLOUDFLARE_R2_ACCOUNT_ID',
  'CLOUDFLARE_R2_ACCESS_KEY_ID',
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'CLOUDFLARE_R2_PRIVATE_BUCKET'
)

foreach ($name in $required) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if (-not $value -or $value.StartsWith('REPLACE_WITH_')) {
    throw "Falta configurar $name en $resolvedEnv o como variable de entorno"
  }
}

if (-not $env:NODE_ENV) { $env:NODE_ENV = 'development' }
if (-not $env:API_HOST) { $env:API_HOST = '127.0.0.1' }
if (-not $env:API_PORT) { $env:API_PORT = '3100' }
if (-not $env:CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS) {
  $env:CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS = '300'
}

Push-Location $projectRoot
try {
  & npm.cmd run db:migrate:deploy
  if ($LASTEXITCODE -ne 0) { throw 'Las migraciones fallaron' }

  $runtimeDirectory = Join-Path $projectRoot 'tmp\runtime'
  New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null

  $api = Start-Process `
    -FilePath 'npm.cmd' `
    -ArgumentList @('run', 'start:api:prod') `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $runtimeDirectory 'api.out.log') `
    -RedirectStandardError (Join-Path $runtimeDirectory 'api.err.log') `
    -PassThru

  $worker = Start-Process `
    -FilePath 'npm.cmd' `
    -ArgumentList @('run', 'start:worker:prod') `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $runtimeDirectory 'worker.out.log') `
    -RedirectStandardError (Join-Path $runtimeDirectory 'worker.err.log') `
    -PassThru

  Write-Output "API_PID=$($api.Id)"
  Write-Output "WORKER_PID=$($worker.Id)"
  Write-Output "API_URL=http://$($env:API_HOST):$($env:API_PORT)/v1"
} finally {
  Pop-Location
}
