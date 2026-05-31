param(
  [ValidateSet("brave", "edge", "chrome")]
  [string]$Browser = "brave",
  [string]$Profile = "Default",
  [string]$VideoUrl = "https://www.youtube.com/watch?v=82IOSYpY6Qo"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$cookiePath = Join-Path $repoRoot "youtube.cookies.txt"
$base64Path = Join-Path $repoRoot "youtube.cookies.base64.txt"

Remove-Item -LiteralPath $cookiePath, $base64Path -Force -ErrorAction SilentlyContinue

yt-dlp `
  --cookies-from-browser "${Browser}:${Profile}" `
  --cookies $cookiePath `
  --no-warnings `
  --no-playlist `
  --force-ipv4 `
  --extractor-args "youtube:player_client=android_vr" `
  --format "b[height<=720][ext=mp4]/18/b[ext=mp4]/best[ext=mp4]" `
  --simulate `
  --print "%(title)s | %(id)s | %(duration)s | %(format_id)s" `
  $VideoUrl

if (!(Test-Path -LiteralPath $cookiePath)) {
  throw "yt-dlp nao gerou $cookiePath. Feche totalmente o navegador e tente novamente."
}

$base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content -LiteralPath $cookiePath -Raw)))
Set-Content -LiteralPath $base64Path -Value $base64 -NoNewline -Encoding UTF8
Set-Clipboard -Value $base64

$cookieInfo = Get-Item -LiteralPath $cookiePath
$base64Info = Get-Item -LiteralPath $base64Path

Write-Host "OK: cookies exportados para $($cookieInfo.FullName)"
Write-Host "OK: base64 salvo em $($base64Info.FullName)"
Write-Host "OK: valor copiado para a area de transferencia."
Write-Host "Configure esse valor no Render em YTDLP_COOKIES_BASE64 como Secret Environment Variable."
