#!/usr/bin/env sh
# Generates the SAML signing key pair ARC-1 uses to sign bearer assertions, plus the IdP metadata file
# to upload in transaction SAML2 (Trusted Providers -> SAML Bearer Assertion Providers -> Add -> Upload Metadata File).
# Usage: ./gen-saml-idp.sh [issuer]      default issuer: arc1-local-saml-idp (must equal SAP_PP_SAML_ISSUER)
# Works in Git Bash on Windows: only the "/CN=..." subject is protected from MSYS path conversion (paths stay converted).
set -eu
ISSUER="${1:-arc1-local-saml-idp}"
DIR="$(cd "$(dirname "$0")" && pwd)/saml"
mkdir -p "$DIR"
KEY="$DIR/arc1-saml-idp.key"
CRT="$DIR/arc1-saml-idp.crt"
META="$DIR/arc1-local-saml-idp-metadata.xml"
if [ -e "$KEY" ]; then
  echo "refusing to overwrite $KEY" >&2
  exit 1
fi
MSYS2_ARG_CONV_EXCL="/CN=" openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 365 -subj "/CN=$ISSUER" -keyout "$KEY" -out "$CRT"
DER="$(sed -e '/-----/d' "$CRT" | tr -d '\r\n')"
# SAP needs only the entity ID and the signing certificate; the SSO endpoints are placeholders and are never called.
cat > "$META" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="$ISSUER">
  <md:IDPSSODescriptor WantAuthnRequestsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>$DER</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified</md:NameIDFormat>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="http://localhost:8091/saml/sso"/>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="http://localhost:8091/saml/sso"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>
XML
chmod 600 "$KEY"
echo "key:      $KEY (keep private; mounted read-only into the container)"
echo "cert:     $CRT"
echo "metadata: $META  (upload in SAML2 on the ABAP system)"
