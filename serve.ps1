# Block Illustrator - zero-dependency local web server (Windows PowerShell 5.1+)
# Serves the built single-file app (dist/index.html) at http://localhost:<Port>/
# Usage:  serve.cmd            (or)  powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8000
param(
  [int]$Port = 8000,
  [string]$Root = (Join-Path $PSScriptRoot 'dist'),
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$index = Join-Path $Root 'index.html'
if (-not (Test-Path $index)) {
  Write-Host "dist/index.html not found. Download it from GitHub (dist/index.html) or run 'npm run build'." -ForegroundColor Red
  exit 1
}

# Try the requested port first, then the following ones (another program or a
# Windows URL reservation may already own the port).
$listener = $null
$prefix = ''
for ($p = $Port; $p -lt $Port + 50; $p++) {
  $candidate = New-Object System.Net.HttpListener
  $candidate.Prefixes.Add("http://localhost:$p/")
  try {
    $candidate.Start()
    $listener = $candidate
    $prefix = "http://localhost:$p/"
    if ($p -ne $Port) { Write-Host "Port $Port is in use; using port $p instead." -ForegroundColor Yellow }
    break
  } catch {
    $candidate.Close()
  }
}
if ($null -eq $listener) {
  Write-Host "Could not find a free port between $Port and $($Port + 49). Try: serve.cmd -Port 9000" -ForegroundColor Red
  exit 1
}

Write-Host "Block Illustrator is running at $prefix  (press Ctrl+C to stop)" -ForegroundColor Green
if (-not $NoBrowser) { Start-Process $prefix }

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
  '.json' = 'application/json; charset=utf-8'
  '.bd'   = 'text/plain; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
}
$rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
      if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
      $file = [IO.Path]::GetFullPath((Join-Path $Root ($path.TrimStart('/') -replace '/', '\')))
      if (-not $file.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $file -PathType Leaf)) {
        $res.StatusCode = 404
        $msg = [Text.Encoding]::UTF8.GetBytes('404 Not Found')
        $res.ContentType = 'text/plain'
        $res.OutputStream.Write($msg, 0, $msg.Length)
      } else {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file).ToLower()
        $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $res.Headers.Add('Cache-Control', 'no-cache')
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    } catch {
      try { $res.StatusCode = 500 } catch {}
    } finally {
      try { $res.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
}
