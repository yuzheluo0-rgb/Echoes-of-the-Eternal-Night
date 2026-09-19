param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$previewRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$previewAddress = 'http://127.0.0.1:5173/'
$previewOpenAddress = $previewAddress + '?motion=on#/world'

function Get-PreviewResponse {
    try { return Invoke-WebRequest -Uri $previewAddress -TimeoutSec 2 -UseBasicParsing }
    catch { return $null }
}

$previewResponse = Get-PreviewResponse
if ($null -ne $previewResponse -and $previewResponse.Content -notmatch 'Echoes of Eternal Night') {
    throw 'Port 5173 is serving another application. Close that server before starting this preview.'
}

if ($null -eq $previewResponse) {
    Push-Location -LiteralPath $previewRoot
    try {
        $previewNode = (Get-Command node -ErrorAction Stop).Source
        if (-not (Test-Path -LiteralPath (Join-Path $previewRoot 'node_modules/vite/bin/vite.js'))) {
            & npm.cmd install
            if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
        }
        $previewLogRoot = Join-Path $previewRoot '.work'
        New-Item -ItemType Directory -Path $previewLogRoot -Force | Out-Null
        $previewServer = Start-Process -FilePath $previewNode `
            -ArgumentList 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort' `
            -WorkingDirectory $previewRoot -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $previewLogRoot 'preview-server.log') `
            -RedirectStandardError (Join-Path $previewLogRoot 'preview-server-error.log')
        $previewDeadline = [DateTime]::UtcNow.AddSeconds(20)
        do {
            Start-Sleep -Milliseconds 350
            $previewResponse = Get-PreviewResponse
            if ($previewServer.HasExited) { throw 'The preview server stopped. See .work/preview-server-error.log.' }
        } while ($null -eq $previewResponse -and [DateTime]::UtcNow -lt $previewDeadline)
        if ($null -eq $previewResponse) { throw 'The preview server did not start within 20 seconds.' }
    }
    finally { Pop-Location }
}

# This script is explicitly launched by the user to open the interactive game preview.
if (-not $NoBrowser) { Start-Process -FilePath $previewOpenAddress }
Write-Output ('Preview ready: ' + $previewOpenAddress)
