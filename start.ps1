# Bard Browser launcher for Windows — install deps if missing, serve the app.
# Usage:  .\start.ps1          (default port 5173)
#         $env:BARD_BROWSER_PORT = 8080; .\start.ps1
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$Port = if ($env:BARD_BROWSER_PORT) { $env:BARD_BROWSER_PORT } elseif ($env:MYRPG_PORT) { $env:MYRPG_PORT } else { "5173" }
$PidFile = Join-Path $PSScriptRoot ".bardbrowser.pid"

if (-not (Test-Path (Join-Path $PSScriptRoot "node_modules"))) {
    Write-Host "Installing dependencies (first run only)..."
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
}

Write-Host "Starting Bard Browser on http://localhost:$Port"

# Run vite directly (same reasoning as start.sh): npm would wrap it in a shell
# whose process tree is harder to stop cleanly on Windows.
$Vite = Join-Path $PSScriptRoot "node_modules\.bin\vite.cmd"
if (-not (Test-Path $Vite)) { $Vite = "npx" }  # fallback: npx vite
$ViteArgs = if ($Vite -eq "npx") { @("vite", "--port", $Port, "--strictPort") } else { @("--port", $Port, "--strictPort") }

$Proc = Start-Process -FilePath $Vite -ArgumentList $ViteArgs -PassThru -NoNewWindow
$Proc.Id | Out-File -FilePath $PidFile -Encoding ascii

# Ctrl+C / process exit -> clean shutdown
$Host.UI.RawUI.WindowTitle = "Bard Browser (port $Port)"
try {
    Register-EngineEvent -SourceIdentifier PowerShell.Exiting -MessageData $PidFile -Action {
        # $event.MessageData carries the pid-file path ($Using: is not valid here)
        $pf = $event.MessageData
        if (Test-Path $pf) {
            $p = Get-Content $pf -ErrorAction SilentlyContinue
            if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
            Remove-Item $pf -ErrorAction SilentlyContinue
        }
    } | Out-Null
} catch { }

# Wait for the server, then open the browser
$Ready = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $null = Invoke-WebRequest -Uri "http://localhost:$Port" -UseBasicParsing -TimeoutSec 2
        $Ready = $true
        break
    } catch { Start-Sleep -Milliseconds 500 }
}

if ($Ready) {
    Write-Host "Bard Browser is running at http://localhost:$Port"
    try { Start-Process "http://localhost:$Port" } catch { Write-Host "Open http://localhost:$Port in your browser." }
    Write-Host "Stop it with Ctrl+C, .\stop.ps1, or the Quit button in the sidebar."
} else {
    Write-Warning "Server did not respond on port $Port yet - it may still be starting."
}

try { Wait-Process -Id $Proc.Id -ErrorAction Stop } catch { }
