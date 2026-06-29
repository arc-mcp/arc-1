# Passwordless SAP GUI logon (SNC SSO) to an ABAP Trial on macOS

A complete, battle-tested guide to set up **passwordless SAP GUI for Java logon** to a local
**SAP ABAP Platform / Cloud Developer Trial** (the "A4H" Docker appliance) on **macOS (Apple
Silicon)** using **SNC** (Secure Network Communications) with **X.509 certificates** — **no
Kerberos, no KDC, no SAP Single Sign-On license**.

> Proven end-to-end against an ABAP Platform 2023 Developer Edition appliance, SAP GUI for Java
> 7.80, macOS arm64, CommonCryptoLib 8.5.56. The same recipe applies to a 2025 trial — only the
> SID/host change.

Throughout, replace these placeholders:

| Placeholder | Meaning | Example |
|---|---|---|
| `<SID>` | the appliance system ID | `A4H` |
| `<NN>` | the instance number | `00` |
| `<EXE>` | the SAP kernel exe dir in the container | `/usr/sap/<SID>/D<NN>/exe` |
| `<SEC>` | the server `sec` dir in the container | `/usr/sap/<SID>/D<NN>/sec` |
| `<USER>` | your ABAP user | `DEVELOPER` |
| `<SERVER_SNC_DN>` | the appliance's SNC identity (Distinguished Name) | `CN=A4H, OU=IDEMOSYSTEM, OU=SAP Web AS, O=SAP Trust Community, C=DE` |
| `<CLIENT_SNC_DN>` | a DN you pick for your client identity | `CN=DEVELOPER, OU=DEV, O=ACME, C=DE` |

---

## How it works (and why X.509, not Kerberos)

SAP GUI talks **DIAG**, not HTTP, so its SSO mechanism is **SNC**. SNC has two credential
flavors: **Kerberos** (needs a KDC / Active Directory + the licensed SAP Single Sign-On product)
and **X.509 certificates** (self-contained, license-free for the encryption/authentication use,
no KDC). For a single developer on a laptop, **X.509 is the right choice** — there is nothing to
license and no domain controller to run.

The mechanics:

1. Both ends own a **PSE** (Personal Security Environment = a cert + key store): the appliance
   has `SAPSNCS.pse` (identity `<SERVER_SNC_DN>`); you create one on the Mac (identity
   `<CLIENT_SNC_DN>`).
2. They **exchange + trust** each other's certificates.
3. The appliance maps your **SNC name** (`p:<CLIENT_SNC_DN>`) to your ABAP user (SU01 → SNC tab).
4. Your client PSE has a stored **credential** (`seclogin`) so it opens with no PIN — that stored
   credential *is* the single sign-on.

At connect time, SAP GUI presents your cert over SNC; the server validates it against its trust
list and maps it to your user → you're in, no password.

```
SAP GUI for Java ──DIAG over SNC (X.509)──▶ [SAProuter] ──▶ ABAP dispatcher (port 32<NN>)
   client PSE (CN=<USER>…)                     optional         server PSE (CN=<SID>…)
        └──────── mutual trust + SU01 SNC-name → user mapping ────────┘
```

A **local** Docker appliance needs no SAProuter — connect straight to `<host>:32<NN>`
(e.g. `localhost:3200`). The router only appears when the appliance is remote.

---

## Prerequisites

- macOS (this guide is Apple Silicon / arm64; Intel works with the matching downloads).
- **SAP GUI for Java** installed (7.80 here). Requirements: SAP Note 3204095. macOS support
  status: SAP Notes 3385617 (Sonoma) / 3517261 (Sequoia) / 3656940 (Tahoe).
- The ABAP appliance reachable (directly or via a **SAProuter**), with shell access to the
  container (admin steps run there).
- **CommonCryptoLib + SAPCAR for macOS arm64** (download below) — needs an S-user with download
  authorization. CommonCryptoLib is export-controlled (SAP Note 1848999); if you cannot download
  it, SNC SSO is not possible from this client.

---

## Part A — Download & unpack the client crypto library (macOS)

From the **SAP Software Center → Software Downloads**, platform **"MACOS ON ARM64 64BIT"**:

- **SAPCAR** (e.g. `SAPCAR_<n>-<id>.ZIP`) — the archive tool.
- **COMMONCRYPTOLIB 8** (e.g. `SAPCRYPTOLIBP_<n>-<id>.SAR`) — the crypto library + `sapgenpse`.

```bash
mkdir -p ~/sap/bin ~/sap/cryptolib ~/sap/sec

# 1. SAPCAR (the ZIP also bundles a libsapcrypto.dylib that SAPCAR itself needs)
unzip ~/Downloads/SAPCAR_*.ZIP -d ~/sap/bin
chmod +x ~/sap/bin/SAPCAR

# 2. macOS Gatekeeper blocks unsigned downloaded binaries — strip the quarantine flag
xattr -cr ~/sap/bin

# 3. extract CommonCryptoLib (run SAPCAR with its lib dir on the loader path)
DYLD_LIBRARY_PATH=~/sap/bin ~/sap/bin/SAPCAR -xvf ~/Downloads/SAPCRYPTOLIBP_*.SAR -R ~/sap/cryptolib
xattr -cr ~/sap/cryptolib
```

`~/sap/cryptolib` now contains `libsapcrypto.dylib`, `libslcryptokernel.dylib`, and `sapgenpse`.

> **Architecture must match.** `file ~/sap/cryptolib/libsapcrypto.dylib` must report the same
> arch (`arm64`) as SAP GUI's bundled JVM (`file "<SAPGUI>.app/Contents/Resources/jre/Contents/Home/lib/libjli.dylib"`).
> A mismatch makes the SNC checkbox un-checkable later.

---

## Part B — Create your client identity (macOS)

```bash
export SECUDIR=~/sap/sec
export DYLD_LIBRARY_PATH=~/sap/cryptolib
SG=~/sap/cryptolib/sapgenpse
PIN='choose-a-strong-pin'

# 1. create your client PSE (self-signed) with your chosen SNC DN
"$SG" gen_pse  -p SAPSNCSC.pse -x "$PIN" -noreq "<CLIENT_SNC_DN>"

# 2. store an SSO credential so the PSE opens with NO pin (this is the single sign-on)
"$SG" seclogin -p SAPSNCSC.pse -x "$PIN" -O "$(whoami)"

# 3. export your certificate — you'll give this to the server to trust
"$SG" export_own_cert -o "$SECUDIR/client.crt" -p SAPSNCSC.pse -x "$PIN"

# confirm your SNC name (you'll need "p:" + this DN)
"$SG" get_my_name -p SAPSNCSC.pse | grep -i Subject
```

Your **client SNC name** is `p:<CLIENT_SNC_DN>`.

> **Gotcha:** `sapgenpse maintain_pk` (used below) **needs `-x <pin>` even when an SSO credential
> exists** — without it the tool silently hangs waiting for the PIN on stdin.

---

## Part C — Enable SNC on the appliance (server, one-time)

All commands run **inside the appliance container** as the `<sid>adm` user. The appliance already
ships CommonCryptoLib (`<EXE>/libsapcrypto.so`), `sapgenpse`, and a server SNC PSE
(`<SEC>/SAPSNCS.pse`, identity `<SERVER_SNC_DN>`).

Confirm the appliance's **actual** SNC identity first (it can differ between trial versions) and
use that exact Subject DN as `<SERVER_SNC_DN>` everywhere below:

```bash
SECUDIR=<SEC> <EXE>/sapgenpse get_my_name -p <SEC>/SAPSNCS.pse | grep -i Subject
```

### C.1 — Add the SNC profile parameters

Append to the **instance profile** (`/sapmnt/<SID>/profile/<SID>_D<NN>_<host>`) — back it up first:

```ini
snc/enable = 1
snc/gssapi_lib = <EXE>/libsapcrypto.so
snc/identity/as = p:<SERVER_SNC_DN>
snc/data_protection/max = 3
snc/data_protection/min = 1
snc/data_protection/use = 3
# Keep password logon working during setup so you cannot lock yourself out:
snc/accept_insecure_gui = 1
snc/accept_insecure_rfc = 1
snc/accept_insecure_cpic = 1
snc/permit_insecure_start = 1
```

Reference for parameter semantics: [Sample Profile Parameter Settings for SNC][snc-sample] and
the [`snc/enable` profile-parameter reference][snc-params].

### C.2 — Credential the server PSE & restart the instance

```bash
# let the work processes open SAPSNCS.pse without interaction
SECUDIR=<SEC> <EXE>/sapgenpse seclogin -p <SEC>/SAPSNCS.pse -O <sid>adm

# restart the ABAP INSTANCE only (see the warning below — do NOT restart the container)
sapcontrol -nr <NN> -function RestartInstance
```

Verify SNC initialized — the work-process trace (`<EXE>/../work/dev_w0`) must show
([SNC Messages on AS ABAP][snc-messages]):

```
N  Product Version = CommonCryptoLib 8.x.xx
N  SncInit(): found:  snc/identity/as=p:<SERVER_SNC_DN>
M  SNC (Secure Network Communication) enabled
M  SncInit o.k.
```

> ### ⚠️ The #1 gotcha: enabling SNC **regenerates** `SAPSNCS.pse`
> The first restart that activates SNC **recreates the server SNC PSE from scratch**, wiping any
> certificates you imported into it beforehand. **Always import the client cert *after* SNC is
> up** (next step), never before. Symptom if you get this wrong: the client fails with
> `GSS-API … A2210223: Server does not trust my certificate path`.

### C.3 — Exchange trust (after SNC is up)

```bash
# copy your client.crt (from Part B) into the container, e.g. /tmp/client.crt, then:
SECUDIR=<SEC> <EXE>/sapgenpse maintain_pk -a /tmp/client.crt -p <SEC>/SAPSNCS.pse   # trust your client
SECUDIR=<SEC> <EXE>/sapgenpse export_own_cert -o /tmp/server.crt -p <SEC>/SAPSNCS.pse  # export server cert
# verify your client is now trusted:
SECUDIR=<SEC> <EXE>/sapgenpse maintain_pk -l -p <SEC>/SAPSNCS.pse
```

Copy `/tmp/server.crt` back to the Mac, then trust it in your client PSE:

```bash
export SECUDIR=~/sap/sec DYLD_LIBRARY_PATH=~/sap/cryptolib
~/sap/cryptolib/sapgenpse maintain_pk -a ~/sap/sec/server.crt -p SAPSNCSC.pse -x 'choose-a-strong-pin'
```

The trust list is re-read **per handshake**, so importing a cert takes effect immediately — no
restart needed.

### C.4 — Map your SNC name to your ABAP user

In SAP GUI (log on with your password this once), transaction **`SU01`** → `<USER>` → **SNC**
tab → **SNC name** = `p:<CLIENT_SNC_DN>` → Save. You should see **"Canonical name defined" ✓**.
(This writes table `USRACLEXT` — always via SU01, never edit the table directly.) Tick *"Allow
password logon for SAP GUI"* if you want password logon to keep working alongside SNC.

---

## Part D — Configure the SAP GUI for Java connection (macOS)

This is the fiddly part on macOS. Two things matter and both are easy to miss.

### D.1 — Launch SAP GUI with the crypto library in its environment

The SNC option stays **greyed out** unless SAP GUI's *process* has `SNC_LIB` set at launch.
Setting it via `launchctl setenv` is unreliable for a Finder-launched app — launch the binary
from a shell instead:

```bash
SNC_LIB=~/sap/cryptolib/libsapcrypto.dylib \
SECUDIR=~/sap/sec \
DYLD_LIBRARY_PATH=~/sap/cryptolib \
"/Applications/SAP Clients/SAPGUI <ver>/SAPGUI <ver>.app/Contents/MacOS/SAPGUI"
```

`DYLD_LIBRARY_PATH` is required so `libsapcrypto.dylib` can load its sibling
`libslcryptokernel.dylib`. (For a permanent setup, set `SNC_LIB`/`SECUDIR` in SAP GUI's own
preferences or a launch wrapper.)

### D.2 — Enable SNC on the connection

Two ways. **The GUI form is finicky; editing the landscape file is the reliable path.**

**Option 1 — GUI form.** Edit the connection → **Security** tab → tick **Enable secure network
communication** → **SNC Name** = `p:<SERVER_SNC_DN>` → **Max. Available** → leave *Use manual
login (no SSO)* **unchecked** → Save. The checkbox is only enabled when D.1 is satisfied *and* the
connection's route is valid (no red ✗ on the System tab).

**Option 2 — landscape XML (reliable).** Quit SAP GUI, edit
`~/Library/Preferences/SAP/SAPGUILandscape.xml`, and on your `<Service …>` element add **two**
attributes:

```xml
sncname="p:<SERVER_SNC_DN>" sncop="9"
```

Set the route with `server="<host>:32<NN>"` (a local appliance is just `localhost:3200`). **Only**
if the appliance sits behind a SAProuter, also add a `routerid` pointing at a `<Router>` entry.
Then relaunch via D.1.

> ### ⚠️ The #2 gotcha: the right attribute is `sncop`, not `sncqop`/`sncon`
> SAP GUI for Java enables SNC for a landscape service when **`sncop` > 0 *and* `sncname` is
> present**. `sncqop` and `sncon` are *connection-string* tokens, **not** landscape attributes —
> set those and SAP GUI silently round-trips them, leaves SNC **off**, and drops you to the
> password screen with **no error**. `sncop="9"` = highest protection (privacy). The expert
> `conn=` string likewise **ignores** `snc_partnername`/`snc_qop` ("Ignored Parameters") — don't
> try to put SNC there.

### D.3 — Connect

Double-click the connection → you're logged on as `<USER>` with **no password**. 🎉

### D.4 — Permanent launcher (start from the Dock)

Launching from a shell every time is tedious, and you **cannot** just bake the env into SAP GUI's
own bundle: it is **adhoc + hardened-runtime** signed, so editing its `Info.plist` (`LSEnvironment`)
or swapping its binary breaks the signature (→ "app is damaged"), and hardened runtime strips
`DYLD_*` anyway. The clean, update-safe fix is a tiny **wrapper app** that sets the env and `exec`s
the real binary. Create it once, then keep it in the Dock:

```bash
WRAP="$HOME/Applications/SAP GUI (SSO).app"
mkdir -p "$WRAP/Contents/MacOS" "$WRAP/Contents/Resources"

cat > "$WRAP/Contents/MacOS/run" <<'SH'
#!/bin/bash
export SNC_LIB="$HOME/sap/cryptolib/libsapcrypto.dylib"
export SECUDIR="$HOME/sap/sec"
export DYLD_LIBRARY_PATH="$HOME/sap/cryptolib"
# pick whatever SAP GUI version is installed (survives updates)
APP=$(ls -d "/Applications/SAP Clients/SAPGUI "*"/SAPGUI "*.app 2>/dev/null | tail -1)
exec "$APP/Contents/MacOS/SAPGUI" "$@"
SH
chmod +x "$WRAP/Contents/MacOS/run"

# optional: reuse the real SAP icon
REALAPP=$(ls -d "/Applications/SAP Clients/SAPGUI "*"/SAPGUI "*.app | tail -1)
ICON=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$REALAPP/Contents/Info.plist" 2>/dev/null)
cp "$REALAPP/Contents/Resources/${ICON%.icns}.icns" "$WRAP/Contents/Resources/app.icns" 2>/dev/null

cat > "$WRAP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>SAP GUI (SSO)</string>
  <key>CFBundleIdentifier</key><string>local.sapgui-sso</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>run</string>
  <key>CFBundleIconFile</key><string>app</string>
</dict></plist>
PLIST

codesign --force --sign - "$WRAP"   # adhoc-sign so Gatekeeper doesn't block it
xattr -cr "$WRAP"
open "$WRAP"                         # then: right-click its Dock icon → Options → Keep in Dock
```

Pin **this** icon and remove the plain SAP GUI one, so you never launch the no-SNC variant by
mistake. Verify the env actually reached the process:

```bash
ps eww "$(pgrep -f 'SAPGUI.*\.app/Contents/MacOS/SAPGUI')" | tr ' ' '\n' | grep -E 'SNC_LIB|SECUDIR'
```

---

## Persistence & operations

- **SNC trust does not survive a container restart.** A `docker stop/start` re-exports the
  appliance's `sec` directory from the image, wiping the imported client cert (the same reason a
  swapped HTTPS server cert is lost on restart). After any container restart: re-run **C.3**
  (import `client.crt` into `SAPSNCS.pse`) — no instance restart needed. The **SU01 mapping
  (C.4) is in the database and *does* persist.** For a hands-off fix that re-imports automatically
  after every restart, see **[Auto-restore trust after restart](#auto-restore-trust-after-restart)** below.
- **Instance restart vs container restart:** use `sapcontrol … RestartInstance` for profile
  changes; it preserves the filesystem PSEs. A full container restart does not.
- **Keep password logon as a fallback** (`snc/accept_insecure_gui=1` + the SU01 "allow password
  logon" flag) until you're confident, so a misconfigured SNC entry never locks you out.

### Auto-restore trust after restart

The trial appliance's entrypoint (a compiled binary) **rebuilds the `sec` dir empty on every boot**,
so the client cert you imported in C.3 is gone after each restart, and the PSE itself can't be made
to persist. The fix is a small **host-side** cron job (the host controls the container, so this
survives both `docker restart` and host reboots, and touches nothing in the appliance image).

On the Docker **host**, store the client cert and a self-heal script:

```bash
sudo mkdir -p /opt/snc-autotrust
sudo cp client.crt /opt/snc-autotrust/client.crt        # the cert exported in Part B

sudo tee /opt/snc-autotrust/sync.sh >/dev/null <<'SH'
#!/bin/bash
# Re-import the SNC client cert into the appliance whenever it's missing. Idempotent.
set -u
C=<container>                       # the appliance's docker container name
SECDIR=/usr/sap/<SID>/D<NN>/sec
EXE=/usr/sap/<SID>/D<NN>/exe
PSE=$SECDIR/SAPSNCS.pse
DN='<CLIENT_SNC_DN>'               # e.g. CN=DEVELOPER, OU=DEV, O=ACME, C=DE
CRT=/opt/snc-autotrust/client.crt

docker ps --format '{{.Names}}' | grep -qx "$C" || exit 0          # container up?
docker exec "$C" test -f "$PSE" || exit 0                          # server PSE present?
# already trusted?  (sapgenpse prints the listing to STDERR — capture it with 2>&1)
docker exec "$C" bash -c "su - <sid>adm -c \"env SECUDIR=$SECDIR $EXE/sapgenpse maintain_pk -l -p $PSE\"" 2>&1 \
  | grep -q "$DN" && exit 0
docker cp "$CRT" "$C:/tmp/snc-client.crt"
docker exec "$C" bash -c "chmod 644 /tmp/snc-client.crt; su - <sid>adm -c \"env SECUDIR=$SECDIR $EXE/sapgenpse maintain_pk -a /tmp/snc-client.crt -p $PSE\""
SH
sudo chmod +x /opt/snc-autotrust/sync.sh

# run every 2 minutes (covers container restart + host reboot)
( sudo crontab -l 2>/dev/null | grep -v snc-autotrust/sync.sh; \
  echo '*/2 * * * * /opt/snc-autotrust/sync.sh >/dev/null 2>&1' ) | sudo crontab -
```

Notes, all learned the hard way:
- **`<sid>adm`'s shell is `csh`** on the appliance → set `SECUDIR` with `env VAR=… cmd`, **not** the
  bash-style `VAR=… cmd` (that throws `Command not found.`).
- **`maintain_pk -a` refuses duplicates** ("PKList NOT changed"), so re-running is always safe.
- After a restart the PKList is genuinely **empty**, so `maintain_pk -a` simply adds the cert — the
  same call as C.3.
- There's a ≤2-minute window after a restart before trust is back; shorten the interval or trigger
  on a `docker events --filter event=start` watcher if you need it instant.

---

## FAQ

**Do I need Kerberos or a KDC?** No. This uses X.509 certificates. Kerberos-based SNC needs a KDC
(Active Directory in every SAP-documented setup) and the licensed SAP Single Sign-On / Secure
Login product (SAP Note 1848999). X.509 SNC is self-contained and license-free here.

**Do I need SAP Single Sign-On / Secure Login Server licenses?** No — encryption and
authentication via SNC with your own certs is license-free per SAP Note 1848999. Licenses are
only required for *user-based* Kerberos/X.509 SSO products and centrally issued short-lived certs.

**Does this also give SSO for ABAP Development Tools (ADT) in Eclipse / VS Code?** No. ADT is an
**HTTP** client (`/sap/bc/adt`); SNC secures only the **DIAG/RFC** channel. ADT SSO is a separate
topic (X.509 *client certificates over HTTPS* — see the arc-1-lsp `client-cert-auth-setup`
guide). SNC here is purely for **SAP GUI**.

**Can I reuse one client PSE for several systems?** Yes. The same `SAPSNCSC.pse` /
`p:<CLIENT_SNC_DN>` can be trusted and SU01-mapped on multiple appliances. Set up each server
(Part C) and add a connection (Part D) per system.

**Self-signed client cert — is that OK?** For a single-developer trial, yes: the server trusts
your individual cert directly (`maintain_pk -a`). In an enterprise you'd instead trust a CA and
let it issue user certs (e.g. via SAP Secure Login Server).

**Where does the actual "single sign-on" come from?** The `seclogin` credential stored next to
your client PSE: it lets the PSE open without a PIN, so SAP GUI can present your cert silently.
Protect `~/sap/sec` (it is your identity) — `chmod 700 ~/sap/sec`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `GSS-API … A2210223: Server does not trust my certificate path` (at `gss_init_sec_context`) | **server** side — your client cert is **not** in the server's `SAPSNCS.pse` trust list — usually wiped when SNC activation regenerated the PSE | re-run **C.3** (`maintain_pk -a /tmp/client.crt …`) *after* SNC is up; takes effect immediately |
| `GSS-API(maj): No credentials were supplied` (at `gss_init_sec_context`) | **client** side — SAP GUI can't open *your* PSE: it was launched **without `SECUDIR`** (from the Dock/Finder, or after a reboot), so it looked in the wrong sec dir. This is **not** caused by a server restart (that throws A2210223) | relaunch with the env (**D.1**) or via the permanent launcher (**D.4**); confirm the credential is intact with `seclogin -l -p SAPSNCSC.pse` (expect "1 readable SSO-Credentials") |
| A box titled **`SAP System Message:`** with short/cryptic text appears, then the session **closes** without logging in (both SSO *and* password) | **not** an SM02 banner — it's an ABAP **short dump (rabax) during logon**, and the dialog often **truncates** the text (e.g. you see only `r` of `rabax during sapgui logon`). The real cause is in the work-process trace named in the message's `location` (e.g. `…_A4H_00-W29` ⇒ work process **W29**) | on the appliance, read that trace for the `Error Code` / `ABAP Program` lines: `grep -aiE "Error Code\|ABAP Program\|rabax" <EXE>/../work/dev_w<NN>` (or open **ST22** once you can log on), then resolve the error it names |
| Double-click just shows the **password screen, no error** | SNC not actually enabled on the connection (wrong landscape attribute) | use **`sncop="9"` + `sncname=…`** (not `sncqop`/`sncon`); see D.2 |
| **"Enable secure network communication" checkbox is greyed** | SAP GUI process has no `SNC_LIB`, or the connection route is invalid (red ✗) | launch via **D.1** (shell env incl. `DYLD_LIBRARY_PATH`); fix the route first |
| `hostname '<backend>' unknown … getaddrinfo` | a SAProuter-internal backend name is being resolved by your Mac | route through the SAProuter: use the structured `server` + `routerid`, not a flat host |
| `Could not read list of logon groups from messageserver` | you picked the load-balancing / message-server entry for a dispatcher port | use a **specific application server** entry (DIAG port `32<NN>`) |
| Expert string shows **"Ignored Parameters: snc_partnername, snc_qop"** | SAP GUI for Java ignores SNC in the `conn=` string | set SNC on the Security tab / landscape XML instead (D.2) |
| `sapgenpse` appears to **hang** | `maintain_pk` waiting for a PIN | pass `-x <pin>` explicitly |
| SNC checkbox greyed even with `SNC_LIB` set | `libsapcrypto.dylib` arch ≠ SAP GUI JVM arch, or quarantined | match arm64/x86; `xattr -cr ~/sap/cryptolib` |

For server-side SNC trace analysis, raise the trace and read `dev_w0` /
[SNC Messages on AS ABAP][snc-messages]. CommonCryptoLib error codes are documented in SAP Note
1848999.

---

## References

All links verified live (June 2026).

SAP product documentation (help.sap.com):

- [Secure Network Communications (SNC) — overview][snc-overview] (ABAP Platform)
- [`snc/enable` and the SNC profile-parameter reference][snc-params] · [Sample Profile Parameter Settings for SNC][snc-sample]
- [Configuring SNC: SAP GUI (SAP Logon)][snc-gui] — the client-side SNC connection settings
- [SNC Messages on AS ABAP][snc-messages] — how to read the work-process (`dev_w*`) SNC trace

SAP Notes (require an SAP account):

- **1848999** — Central Note for CommonCryptoLib 8 (download, licensing, error codes).
- **3204095** — SAP GUI for Java 7.80 requirements; **3385617 / 3517261 / 3656940** — macOS
  Sonoma / Sequoia / Tahoe support status.
- **146505** — SAP GUI for the Java environment (general).
- **2425150** — SNC Client Encryption 2.0 (note: SNC Client Encryption itself is
  encryption-only, **no SSO** — this guide uses your own PSE for SSO instead).

Community / background (step-by-step companions):

- [SAPGUI Encryption and SSO with PSEs and Keychain for MacBooks — amd64 or arm64][community-mac]
  — the closest companion to this guide (PSE method, `SNCWIZARD`, macOS).
- [CommonCryptoLib: Manage PSE files and SSO Credentials (cred_v2)][community-cryptolib]
  — deep dive on `sapgenpse` / `seclogin` / the SSO credential.
- [Notes on installing SAP GUI for Java for macOS][community-mac-install] — client install specifics.
- [ABAP Platform Trial image — end-user docs & FAQ][appliance] (SAP-docs) — the appliance itself.

[snc-overview]: https://help.sap.com/docs/ABAP_PLATFORM_NEW/e73bba71770e4c0ca5fb2a3c17e8e229/e656f466e99a11d1a5b00000e835363f.html
[snc-params]: https://help.sap.com/docs/SAP_NETWEAVER_750/e73bba71770e4c0ca5fb2a3c17e8e229/59e74eec7c394322869c752947412bb2.html
[snc-sample]: https://help.sap.com/doc/saphelp_nw75/7.5.5/en-US/7a/4ca8d131cb4c479e579b3122b8d947/content.htm?no_cache=true
[snc-gui]: https://help.sap.com/docs/SAP_NETWEAVER_750/e73bba71770e4c0ca5fb2a3c17e8e229/dd2e029250f64ed682e1b2f3eda66fca.html
[snc-messages]: https://help.sap.com/doc/saphelp_nw73ehp1/7.31.19/en-us/19/c6f1401a184561a6c444eee325e6fa/content.htm?no_cache=true
[community-mac]: https://community.sap.com/t5/devops-and-system-administration-blogs/sapgui-encryption-and-sso-with-pses-and-keychain-for-macbooks-amd64-or/ba-p/13550769
[community-cryptolib]: https://community.sap.com/t5/technology-blog-posts-by-members/commoncryptolib-manage-pse-files-and-sso-credentials-cred-v2/ba-p/13493223
[community-mac-install]: https://community.sap.com/t5/technology-blog-posts-by-members/notes-on-installing-sapgui-for-java-for-macos/ba-p/13522256
[appliance]: https://github.com/SAP-docs/abap-platform-trial-image
