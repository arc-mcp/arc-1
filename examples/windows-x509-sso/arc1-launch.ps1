# Example launcher for SAP systems that log users on with an X.509 client certificate (Windows SSO).
# Flow: authenticate to ADT with the Windows user certificate (mutual TLS)
#       -> write the SAP session cookies as Netscape file -> start ARC-1 with SAP_COOKIE_FILE.
# stdout is reserved for MCP JSON-RPC, so all messages go to stderr.
#
# Configuration comes from the environment (the "env" block of the MCP server entry):
#   SAP_URL, SAP_CLIENT          target system (same variables ARC-1 reads)
#   ARC1_CERT_ISSUER             optional issuer filter for the user certificate, wildcards allowed;
#                                without it every valid client certificate is tried until SAP accepts one
#   ARC1_EXE                     path to arc-1.exe (default: arc-1.exe from PATH)
#   ARC1_COOKIE_DIR              cookie directory (default: %LOCALAPPDATA%\arc1-cookies)
#   ARC1_COOKIE_REFRESH_MINUTES  re-logon interval (default: 15)
#   SAP_COOKIE_FILE              overrides the generated cookie file name
# Test in a terminal: set the variables, then run  .\arc1-launch.ps1 -LoginOnly
param([switch]$LoginOnly)

function Log($msg) { [Console]::Error.WriteLine("[arc1-launch] $msg") }

$url = $env:SAP_URL
if (-not $url) { Log 'SAP_URL is not set.'; exit 1 }
$certIssuer = $env:ARC1_CERT_ISSUER # optional
$client = if ($env:SAP_CLIENT) { $env:SAP_CLIENT } else { '100' }
$arc1 = if ($env:ARC1_EXE) { $env:ARC1_EXE } else { 'arc-1.exe' }
$cookieDir = if ($env:ARC1_COOKIE_DIR) { $env:ARC1_COOKIE_DIR } else { Join-Path $env:LOCALAPPDATA 'arc1-cookies' }
$refreshMinutes = if ($env:ARC1_COOKIE_REFRESH_MINUTES) { [int]$env:ARC1_COOKIE_REFRESH_MINUTES } else { 15 }
$hostName = ([uri]$url).Host
$file = if ($env:SAP_COOKIE_FILE) { $env:SAP_COOKIE_FILE } else { Join-Path $cookieDir "cookies-$hostName-$client.txt" }
New-Item -ItemType Directory -Force -Path (Split-Path $file) | Out-Null

# Authenticates via mutual TLS and writes the resulting SAP session cookies as Netscape file.
$saveCookies = {
    param($url, $file, $certIssuer, $client)
    $certs = @(Get-ChildItem Cert:\CurrentUser\My | Where-Object {
        $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date) -and (-not $certIssuer -or $_.Issuer -like $certIssuer) -and
        $_.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.2' # Client Authentication
    } | Sort-Object NotAfter -Descending)
    if ($certs.Count -eq 0) { throw "No valid user certificate found (issuer filter: '$certIssuer')." }
    # Without an issuer filter every candidate is tried; the first one SAP accepts wins.
    $session = $null
    foreach ($cert in $certs) {
        $candidate = New-Object Microsoft.PowerShell.Commands.WebRequestSession
        try {
            $r = Invoke-WebRequest -Uri "$url/sap/bc/adt/discovery?sap-client=$client" -Certificate $cert -WebSession $candidate `
                -Headers @{ Accept = 'application/atomsvc+xml' } -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
            # Some releases omit the sap-authenticated header; an anonymous call returns 401 instead.
            if ($r.StatusCode -eq 200 -and $r.Headers['Content-Type'] -match 'xml') { $session = $candidate; break }
        } catch { }
    }
    if (-not $session) { throw 'SAP did not accept any user certificate.' }
    $cookieHost = ([uri]$url).Host
    $lines = @('# Netscape HTTP Cookie File')
    foreach ($c in $session.Cookies.GetCookies($url)) {
        $lines += "$cookieHost`tFALSE`t/`tTRUE`t0`t$($c.Name)`t$($c.Value)"
    }
    $tmp = "$file.tmp"
    Set-Content -Path $tmp -Value $lines -Encoding ASCII
    Move-Item -Path $tmp -Destination $file -Force
}

try {
    & $saveCookies $url $file $certIssuer $client
    Log "[$hostName client $client] Certificate logon OK."
} catch {
    Log "[$hostName client $client] Logon failed: $($_.Exception.Message)"
    exit 1
}

if ($LoginOnly) { exit 0 }

# Keep the session alive: ARC-1 re-reads the cookie file after a 401, so no restart is needed.
$bg = [powershell]::Create()
[void]$bg.AddScript({
    param($saveCookies, $url, $file, $certIssuer, $client, $minutes)
    while ($true) {
        Start-Sleep -Seconds ($minutes * 60)
        try { & $saveCookies $url $file $certIssuer $client } catch { }
    }
}).AddArgument($saveCookies).AddArgument($url).AddArgument($file).AddArgument($certIssuer).AddArgument($client).AddArgument($refreshMinutes)
[void]$bg.BeginInvoke()

$env:SAP_COOKIE_FILE = $file
if (-not $env:ARC1_SYSTEM_LABEL) { $env:ARC1_SYSTEM_LABEL = "$hostName client $client" }

& $arc1
exit $LASTEXITCODE
