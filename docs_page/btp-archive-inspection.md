# Inspect a BTP deployment archive

Before deploying an MTAR, check **every nested application payload** for credentials and local files. Run the Bash or PowerShell check below from the ARC-1 checkout used to build the archive.

An MTAR contains `<module>/data.zip` payloads. Listing only the outer archive misses application files. The checks reject missing/unreadable payloads and known sensitive filenames. The UI AppRouter's root `.npmrc` is allowed only when it exactly matches `btp/approuter/.npmrc` in that checkout.

<a id="bash"></a>

## Bash or zsh

```bash
inspect_mtar() (
  set -o pipefail
  deny='\.env|\.npmrc|service-key|\.(key|pem|p12|pfx|pse|jks|keystore)$'
  mtar=${1:?Pass the exact MTAR path}
  [ -f "$mtar" ] || { echo "FAIL: archive not found: $mtar"; return 1; }
  echo "$mtar"
  unzip -l "$mtar" || { echo 'FAIL: unreadable archive'; return 1; }
  members=$(unzip -Z1 "$mtar" | grep '/data\.zip$') ||
    { echo 'FAIL: no <module>/data.zip member'; return 1; }
  tmp=$(mktemp -d) || return 1
  trap 'rm -rf "$tmp"' EXIT
  while IFS= read -r member; do
    unzip -p "$mtar" "$member" > "$tmp/payload.zip" || { echo "FAIL: cannot extract $member"; return 1; }
    entries=$(unzip -Z1 "$tmp/payload.zip") || { echo "FAIL: cannot read $member"; return 1; }
    n=$(printf '%s\n' "$entries" | wc -l) || { echo "FAIL: cannot count $member"; return 1; }
    echo "-- $member: $n entries"
    bad=$(printf '%s\n' "$entries" | grep -Ei "$deny" || true)
    if [ "$member" = 'arc1-ui-router/data.zip' ]; then
      printf '%s\n' "$entries" | grep -Fx '.npmrc' >/dev/null ||
        { echo 'FAIL: arc1-ui-router/data.zip is missing its required .npmrc'; return 1; }
      unzip -p "$tmp/payload.zip" .npmrc > "$tmp/approuter.npmrc" ||
        { echo 'FAIL: cannot extract arc1-ui-router/.npmrc'; return 1; }
      cmp -s "$tmp/approuter.npmrc" btp/approuter/.npmrc ||
        { echo 'FAIL: packaged arc1-ui-router/.npmrc differs from the source checkout'; return 1; }
      bad=$(printf '%s\n' "$bad" | grep -Ev '^\.npmrc$' || true)
    fi
    [ -z "$bad" ] || { printf '%s\n' "$bad"; echo "FAIL: denied path in $member"; return 1; }
  done <<< "$members"
  echo 'PASS: every payload inspected, no denied paths or unexpected npm config'
)
inspect_mtar "mta_archives/arc1-mcp_<version>.mtar"
```

The function returns success only after every payload passes. Use the exact archive path, without a glob: multiple archives are not scanned automatically. The subshell keeps its options and cleanup trap local.

Review the full payload listing for unexpected files too. Substitute the exact archive and member names printed above:

```bash
(
  arc1_inspect_dir=$(mktemp -d) || exit 1
  trap 'rm -rf "$arc1_inspect_dir"' EXIT
  unzip -p "<exact-path-to.mtar>" '<module>/data.zip' > "$arc1_inspect_dir/payload.zip" || exit 1
  unzip -l "$arc1_inspect_dir/payload.zip" | less
)
```

## PowerShell

The check copies the MTAR with a `.zip` extension for `Expand-Archive`:

```powershell
$ErrorActionPreference = 'Stop'
$deny = '\.env|\.npmrc|service-key|\.(key|pem|p12|pfx|pse|jks|keystore)$'
$mtar = Get-Item "mta_archives/arc1-mcp_<version>.mtar"
$mtar.FullName
$tmp = Join-Path $env:TEMP ([guid]::NewGuid())
try {
  Copy-Item $mtar.FullName "$tmp.zip"
  Expand-Archive "$tmp.zip" "$tmp-outer"
  $members = @(Get-ChildItem "$tmp-outer" -Recurse -Force -Filter data.zip -File)
  if ($members.Count -eq 0) { throw "FAIL: no <module>/data.zip member in $($mtar.Name)" }
  $bad = @()
  foreach ($member in $members) {
    $dest = Join-Path "$tmp-payload" $member.Directory.Name
    Expand-Archive $member.FullName $dest
    $files = @(Get-ChildItem $dest -Recurse -Force -File)
    if ($files.Count -eq 0) { throw "FAIL: empty payload $($member.Directory.Name)" }
    "-- $($member.Directory.Name): $($files.Count) files"
    $allowedNpmrc = $null
    if ($member.Directory.Name -eq 'arc1-ui-router') {
      $allowedNpmrc = Join-Path $dest '.npmrc'
      if (-not (Test-Path $allowedNpmrc -PathType Leaf)) {
        throw 'FAIL: arc1-ui-router/data.zip is missing its required .npmrc'
      }
      $sourceNpmrc = (Resolve-Path 'btp/approuter/.npmrc').Path
      if ((Get-FileHash $allowedNpmrc -Algorithm SHA256).Hash -ne
          (Get-FileHash $sourceNpmrc -Algorithm SHA256).Hash) {
        throw 'FAIL: packaged arc1-ui-router/.npmrc differs from the source checkout'
      }
    }
    $bad += $files | Where-Object {
      $relativePath = $_.FullName.Substring($dest.Length + 1)
      $relativePath -match $deny -and (!$allowedNpmrc -or $_.FullName -ne $allowedNpmrc)
    }
  }
  if ($bad) { $bad.FullName; throw 'FAIL: denied path in payload' }
  'PASS: every payload inspected, no denied paths or unexpected npm config'
} finally {
  Remove-Item "$tmp.zip","$tmp-outer","$tmp-payload" -Recurse -Force -ErrorAction SilentlyContinue
}
```

The application payload must not contain `.env*`, service-key exports, customer `.mtaext` files,
private keys, certificates, local MCP configuration, source tests, operator artifacts, or an
`.npmrc` other than the exact `btp/approuter/.npmrc` from the source checkout in the UI AppRouter payload. The MTA
build has an explicit denylist and CI coverage for critical names; archive inspection is still a
release gate because a future file type can evade a denylist.

## Continue deployment

After both the automated check and your file-list review pass, continue with [Deploy the MTA](btp-cloud-foundry-deployment.md#6-deploy-the-mta). A checksum records the artifact identity; it does not establish that the artifact contains no secrets.
