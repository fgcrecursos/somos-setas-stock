# =====================================================================
# Arranca el bot de stock en esta compu (gratis, sin servidor).
#
#   1. Abre un tunel publico https (tunnelmole) hacia n8n (puerto 5678).
#   2. Arranca n8n con esa direccion como WEBHOOK_URL.
#   3. Al arrancar, n8n le avisa a Telegram la direccion nueva (el flujo
#      tiene que estar ACTIVO). No hace falta tocar nada en Telegram.
#
# Uso: clic derecho > "Ejecutar con PowerShell", o:
#   powershell -ExecutionPolicy Bypass -File bot\local\iniciar-bot.ps1
#
# Dejar esta ventana abierta: si se cierra, el bot deja de responder.
# =====================================================================

$ErrorActionPreference = 'Stop'
$puerto = 5678
$log = Join-Path $env:TEMP 'bot-stock-tunel.log'

# n8n ya corriendo en el puerto: no se puede arrancar otro.
if (Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "Ya hay algo usando el puerto $puerto (otro n8n abierto?). Cerralo y volve a correr este archivo." -ForegroundColor Yellow
  Read-Host 'Enter para salir'
  exit 1
}

# Un tunel que quedo abierto de la vez anterior (se cerro la ventana sin
# Ctrl+C) traba el archivo de registro: se cierra antes de abrir uno nuevo.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -match 'tunnelmole' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

Write-Host 'Abriendo el tunel publico...' -ForegroundColor Cyan
foreach ($f in @($log, "$log.err")) {
  if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
}
if (Test-Path $log) {
  # Si igual sigue trabado, se usa otro archivo.
  $log = Join-Path $env:TEMP ("bot-stock-tunel-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
}

# tunnelmole se cierra si al abrir no hay nada escuchando en el puerto, y
# n8n necesita saber la direccion del tunel antes de arrancar. Un servidor
# provisorio ocupa el puerto hasta que n8n toma su lugar.
$provisorio = Start-Process -FilePath 'node' -WindowStyle Hidden -PassThru -ArgumentList '-e', `
  "require('http').createServer((q,s)=>s.end('arrancando')).listen($puerto)"
Start-Sleep -Seconds 2
$tunel = Start-Process -FilePath 'npx.cmd' -ArgumentList '--yes', 'tunnelmole', "$puerto" `
  -RedirectStandardOutput $log -RedirectStandardError "$log.err" -WindowStyle Hidden -PassThru

$url = $null
for ($i = 0; $i -lt 90 -and -not $url; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $log) {
    $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.tunnelmole\.net' -AllMatches | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value }
  }
  if ($tunel.HasExited) { break }
}

if (-not $url) {
  Stop-Process -Id $provisorio.Id -Force -ErrorAction SilentlyContinue
  Write-Host 'No se pudo abrir el tunel. Revisa la conexion a internet y volve a intentar.' -ForegroundColor Red
  if (Test-Path "$log.err") { Get-Content "$log.err" | Select-Object -Last 5 }
  Read-Host 'Enter para salir'
  exit 1
}

Stop-Process -Id $provisorio.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Write-Host "Tunel listo: $url" -ForegroundColor Green
Write-Host 'Arrancando n8n (tarda un minuto). No cierres esta ventana.' -ForegroundColor Cyan
Write-Host "Editor: http://localhost:$puerto" -ForegroundColor Gray

$env:WEBHOOK_URL = "$url/"
$env:N8N_DIAGNOSTICS_ENABLED = 'false'
try {
  & n8n start
} finally {
  # Al cerrar n8n (Ctrl+C) se cierra tambien el tunel.
  if (-not $tunel.HasExited) { Stop-Process -Id $tunel.Id -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -match 'tunnelmole' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
