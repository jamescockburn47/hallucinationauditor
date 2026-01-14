# Hallucination Auditor - Startup Script (PowerShell)
# Kills existing servers and starts fresh on consistent ports

Write-Host "========================================"
Write-Host "  Hallucination Auditor - Starting..."
Write-Host "========================================"
Write-Host ""

# Kill any existing processes on our ports
Write-Host "[1/4] Stopping existing servers..."
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}
Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}

# Small delay to let ports free up
Start-Sleep -Seconds 2

# Start API server in background
Write-Host "[2/4] Starting API server on port 8000..."
$apiJob = Start-Process -FilePath "python" -ArgumentList "server.py" -WorkingDirectory "$PSScriptRoot\api" -WindowStyle Hidden -PassThru

# Wait for API to be ready
Start-Sleep -Seconds 3

# Start UI server
Write-Host "[3/4] Starting UI server on port 5173..."
$uiJob = Start-Process -FilePath "npm" -ArgumentList "run", "dev", "--", "--port", "5173", "--strictPort" -WorkingDirectory "$PSScriptRoot\ui" -WindowStyle Hidden -PassThru

# Wait for UI to be ready
Start-Sleep -Seconds 3

Write-Host "[4/4] Opening browser..."
Start-Process "http://localhost:5173"

Write-Host ""
Write-Host "========================================"
Write-Host "  Servers are running:"
Write-Host "  - API:  http://localhost:8000"
Write-Host "  - UI:   http://localhost:5173"
Write-Host "========================================"
Write-Host ""
Write-Host "Press Enter to stop all servers..."
Read-Host

# Cleanup on exit
Write-Host ""
Write-Host "Stopping servers..."
if ($apiJob) { Stop-Process -Id $apiJob.Id -Force -ErrorAction SilentlyContinue }
if ($uiJob) { Stop-Process -Id $uiJob.Id -Force -ErrorAction SilentlyContinue }
Write-Host "Done."
