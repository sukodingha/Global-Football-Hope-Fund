param(
    [int]$Port = 8000
)

$root = (Get-Location).Path
$prefix = "http://localhost:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Output "Serving $root at $prefix"

$mime = @{ 
    ".html" = "text/html"
    ".css" = "text/css"
    ".js" = "application/javascript"
    ".json" = "application/json"
    ".png" = "image/png"
    ".jpg" = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".svg" = "image/svg+xml"
    ".ico" = "image/x-icon"
    ".woff" = "font/woff"
    ".woff2" = "font/woff2"
    ".ttf" = "font/ttf"
    ".map" = "application/octet-stream"
}

while ($true) {
    $context = $listener.GetContext()
    $req = $context.Request
    $path = $req.Url.AbsolutePath.TrimStart('/')
    if ($path -eq '') { $path = 'index.html' }
    $file = Join-Path $root $path
    if (-not (Test-Path $file)) {
        $context.Response.StatusCode = 404
        $buffer = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
        $context.Response.ContentLength64 = $buffer.Length
        $context.Response.OutputStream.Write($buffer,0,$buffer.Length)
        $context.Response.Close()
        continue
    }
    $ext = [System.IO.Path]::GetExtension($file).ToLower()
    $ctype = $mime[$ext]
    if (-not $ctype) { $ctype = 'application/octet-stream' }
    $context.Response.ContentType = $ctype
    $bytes = [System.IO.File]::ReadAllBytes($file)
    $context.Response.ContentLength64 = $bytes.Length
    $context.Response.OutputStream.Write($bytes,0,$bytes.Length)
    $context.Response.Close()
}
