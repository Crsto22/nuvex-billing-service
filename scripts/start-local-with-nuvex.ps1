param(
  [string]$NuvexEnvPath = '..\nobitex-backend\nobitex-backend\.env',
  [string]$LocalEnvPath = '.env.local',
  [string]$DatabaseName = 'nuvex_billing',
  [int]$ApiPort = 3100
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$resolvedEnv = [System.IO.Path]::GetFullPath(
  (Join-Path $projectRoot $NuvexEnvPath)
)
$resolvedLocalEnv = [System.IO.Path]::GetFullPath(
  (Join-Path $projectRoot $LocalEnvPath)
)

if (-not (Test-Path -LiteralPath $resolvedEnv)) {
  throw "No se encontro el archivo de entorno de Nuvex: $resolvedEnv"
}

function Read-EnvValueFromFile([string]$Name, [string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $prefix = "${Name}="
  $line = Get-Content -LiteralPath $Path |
    Where-Object { $_.StartsWith($prefix) } |
    Select-Object -First 1
  if (-not $line) { return $null }
  return $line.Substring($prefix.Length).Trim().Trim('"').Trim("'")
}

function Read-EnvValue([string]$Name) {
  return Read-EnvValueFromFile $Name $resolvedEnv
}

function Read-RequiredLocalSecret([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if (-not $value) {
    $value = Read-EnvValueFromFile $Name $resolvedLocalEnv
  }
  if (-not $value) {
    throw "Falta $Name. Configuralo como variable de entorno o en $resolvedLocalEnv"
  }
  return $value
}

$sourceDatabaseUrl = Read-EnvValue 'DATABASE_URL'
if (-not $sourceDatabaseUrl) {
  throw 'Nuvex no tiene DATABASE_URL configurada'
}

$databaseUrl = [UriBuilder]$sourceDatabaseUrl
$databaseUrl.Path = "/$DatabaseName"
$env:DATABASE_URL = $databaseUrl.Uri.AbsoluteUri
$env:NODE_ENV = 'development'
$env:API_HOST = '127.0.0.1'
$env:API_PORT = $ApiPort.ToString()
$env:CORS_ORIGINS = 'http://localhost:3000'
$env:SECRETS_ENCRYPTION_KEY = Read-RequiredLocalSecret 'SECRETS_ENCRYPTION_KEY'
$env:API_KEY_PEPPER = Read-RequiredLocalSecret 'API_KEY_PEPPER'
$env:PLATFORM_ADMIN_KEY = Read-RequiredLocalSecret 'PLATFORM_ADMIN_KEY'

$r2Keys = @(
  'CLOUDFLARE_R2_ACCOUNT_ID',
  'CLOUDFLARE_R2_ACCESS_KEY_ID',
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'CLOUDFLARE_R2_PRIVATE_BUCKET',
  'CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS'
)

foreach ($key in $r2Keys) {
  $value = Read-EnvValue $key
  if ($value) { Set-Item -Path "Env:$key" -Value $value }
}

foreach ($required in $r2Keys[0..3]) {
  if (-not (Get-Item -Path "Env:$required" -ErrorAction SilentlyContinue)) {
    throw "Falta $required en el entorno de Nuvex"
  }
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
  Write-Output "API_URL=http://127.0.0.1:$ApiPort/v1"
} finally {
  Pop-Location
}
