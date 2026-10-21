# Function parameter short texts (#1040)

`parameters[].description` writes an explicit native short text for importing, exporting,
changing, or table parameters. It does not copy a DDIC label automatically. The value is
1–60 printable, nonblank characters in the function group's original language.

## Contract and evidence

SAP documents [parameter ABAP Doc tags](https://help.sap.com/saphelp_em92/helpdata/en/4e/c511186e391014adc9fffe4e204223/content.htm)
and [short-text synchronization](https://help.sap.com/docs/SAP_NETWEAVER_750/c238d694b825421f940829321ffa326a/8327c3ff3fcb424584636bbc33211d53.html).
ARC-1 accepts up to 60 characters; synchronization is available from 7.5 and uses the original language.

The following sequence was verified on SAP_BASIS 758 SP02 through direct HTTPS Basic ADT
requests and native SE37 inspection, using disposable local function groups and RFC function modules:

| Step | Source readback | Native SE37 parameter short text |
|---|---|---|
| Create typed parameters without descriptions | Signature present | Blank |
| Add synchronized ABAP Doc without `lang`, save and activate | New text present | Still blank |
| Add `lang="en"` for the English-original object, save and activate | New text present | Updated |

The result was repeated on a fresh fixture. Import and export fields were inspected independently.
Function-group metadata returned `masterLanguage="EN"` for both English and German request languages;
its `language` attribute followed the request language. ARC-1 therefore uses only the parent group's
`masterLanguage`, refuses a missing/invalid value, and does not infer it from server configuration.

```abap
"! @parameter iv_input | <p class="shorttext synchronized" lang="en">Input value</p>
FUNCTION z_example
  IMPORTING
    VALUE(iv_input) TYPE char10.
ENDFUNCTION.
```

`SAPRead(includeSignature=true)` reads the description from ABAP Doc source. It is not an independent
read of the SE37 metadata field: a missing or incorrect `lang` can leave those two representations
different. Explicit structured writes set the verified original language; omitted descriptions preserve
existing documentation. Clearing descriptions, exception descriptions, and automatic DDIC label lookup
are outside this change.

On the same release, native synchronization kept `&#39;`, `&#33;`, `&quot;`, and `&apos;` literally in the
SE37 short text, despite source readback decoding them. Generated text therefore uses `&amp;`,
`&lt;`, `&gt;`, and `&#64;`, with literal quotes and exclamation marks in paragraph
text. SAP's current [ABAP Doc syntax](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENDOCCOMMENT.html)
permits escaping special characters when necessary. Exact generated-source tests cover create and
replacement, including literal entity-looking input; a parser round trip alone cannot verify native decoding.

## Source preservation

Leading blank and full-line comment lines may precede `FUNCTION`. A shared header locator is used by
read, create, and update so documented full sources are not mistaken for body-only input. Signature
edits preserve the prefix, body and footer; removed data parameters lose their attached parameter-doc
section. Explicit descriptions replace one recognized short-text paragraph and retain surrounding prose.
Ambiguous or unsupported markup is refused before a source PUT; source-only editing remains available.

Regression tests cover these boundaries, original-language selection, escaping, and single/batch
handler paths. Native synchronization is established by the SE37 observations above, not source echo.
