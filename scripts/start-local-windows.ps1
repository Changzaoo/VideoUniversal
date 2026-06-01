[CmdletBinding()]
param(
  [int]$Port = 47873,
  [string]$HostName = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$BackendDir = Join-Path $ProjectRoot "backend"
$FrontendDir = Join-Path $ProjectRoot "frontend"
$ServerPath = Join-Path $BackendDir "dist\server.js"
$FrontendIndexPath = Join-Path $FrontendDir "dist\index.html"
$LogDir = Join-Path $env:LOCALAPPDATA "VideoUniversal"
$StartupLog = Join-Path $LogDir "startup.log"
$OutputLog = Join-Path $LogDir "backend.log"
$ErrorLog = Join-Path $LogDir "backend.err.log"

function Write-StartupLog {
  param([string]$Message)

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $StartupLog -Value "[$timestamp] $Message"
}

function Test-PortInUse {
  param([int]$TcpPort)

  return [bool](Get-NetTCPConnection -LocalPort $TcpPort -State Listen -ErrorAction SilentlyContinue)
}

function Test-HealthyApp {
  param(
    [string]$HealthHost,
    [int]$HealthPort
  )

  try {
    $response = Invoke-RestMethod -Uri "http://$HealthHost`:$HealthPort/api/health" -TimeoutSec 2
    return $response.ok -eq $true
  } catch {
    return $false
  }
}

function Ensure-Dependencies {
  param(
    [string]$PackageDir,
    [string]$Label
  )

  if (Test-Path -LiteralPath (Join-Path $PackageDir "node_modules")) {
    return
  }

  Write-StartupLog "Installing $Label dependencies."
  Push-Location $PackageDir
  try {
    & npm ci 1>> $OutputLog 2>> $ErrorLog
    if ($LASTEXITCODE -ne 0) {
      throw "npm ci failed for $Label with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

function Ensure-Build {
  param(
    [string]$PackageDir,
    [string]$OutputPath,
    [string]$Label
  )

  if (Test-Path -LiteralPath $OutputPath) {
    return
  }

  Write-StartupLog "Building $Label."
  Push-Location $PackageDir
  try {
    & npm run build 1>> $OutputLog 2>> $ErrorLog
    if ($LASTEXITCODE -ne 0) {
      throw "npm run build failed for $Label with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Write-StartupLog "Startup requested on http://$HostName`:$Port."

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found in PATH."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm was not found in PATH."
}

if (Test-PortInUse -TcpPort $Port) {
  if (Test-HealthyApp -HealthHost $HostName -HealthPort $Port) {
    Write-StartupLog "App is already running on port $Port."
    exit 0
  }

  throw "Port $Port is already in use by another process."
}

Ensure-Dependencies -PackageDir $BackendDir -Label "backend"
Ensure-Dependencies -PackageDir $FrontendDir -Label "frontend"
Ensure-Build -PackageDir $FrontendDir -OutputPath $FrontendIndexPath -Label "frontend"
Ensure-Build -PackageDir $BackendDir -OutputPath $ServerPath -Label "backend"

$env:HOST = $HostName
$env:PORT = [string]$Port
$env:SERVE_FRONTEND = "true"

Write-StartupLog "Starting Node server."
Push-Location $BackendDir
try {
  & node $ServerPath 1>> $OutputLog 2>> $ErrorLog
  $exitCode = $LASTEXITCODE
  Write-StartupLog "Node server exited with code $exitCode."
  exit $exitCode
} finally {
  Pop-Location
}
