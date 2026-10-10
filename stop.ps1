# Stop Bard Browser — this project's server only, never every vite on the machine.
Set-Location -Path $PSScriptRoot
$PidFile = Join-Path $PSScriptRoot ".bardbrowser.pid"
$Port = if ($env:BARD_BROWSER_PORT) { $env:BARD_BROWSER_PORT } elseif ($env:MYRPG_PORT) { $env:MYRPG_PORT } else { "5173" }

if (Test-Path $PidFile) {
    $p = Get-Content $PidFile -ErrorAction SilentlyContinue
    if ($p) {
        try {
            Stop-Process -Id $p -Force -ErrorAction Stop
            Remove-Item $PidFile -ErrorAction SilentlyContinue
            Write-Host "Bard Browser stopped."
            exit 0
        } catch { Remove-Item $PidFile -ErrorAction SilentlyContinue }
    }
}

# Not tracked (or already dead) — try the running server's quit endpoint.
try {
    Invoke-WebRequest -Uri "http://localhost:$Port/__quit" -Method POST -UseBasicParsing -TimeoutSec 3 | Out-Null
    Write-Host "Bard Browser stopped (via the running server on port $Port)."
} catch {
    Write-Host "Bard Browser does not appear to be running."
}
