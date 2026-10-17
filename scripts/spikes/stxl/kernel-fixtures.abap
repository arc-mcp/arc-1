CLASS ZCL_ARC1_STXL_ORACLE DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS ZCL_ARC1_STXL_ORACLE IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    TYPES: BEGIN OF ty_case,
             name TYPE string,
             compressed TYPE string,
             plain TYPE string,
             expected TYPE STANDARD TABLE OF tline WITH EMPTY KEY,
           END OF ty_case.
    DATA cases TYPE STANDARD TABLE OF ty_case WITH EMPTY KEY.
    DATA lines TYPE STANDARD TABLE OF tline WITH EMPTY KEY.
    DO 9 TIMES.
      DATA(case_no) = sy-index.
      CLEAR lines.
      CASE case_no.
        WHEN 1.
        WHEN 2.
          APPEND INITIAL LINE TO lines.
        WHEN 3.
          APPEND VALUE #( tdformat = '*' tdline = 'Hello world!' ) TO lines.
        WHEN 4.
          APPEND VALUE #( tdformat = '*' tdline = 'Literal &amp; & <tag> > entity fidelity' ) TO lines.
          APPEND VALUE #( tdformat = '/:' tdline = '  leading  and internal spaces  ' ) TO lines.
          APPEND VALUE #( tdformat = '=' tdline = cl_abap_char_utilities=>horizontal_tab && 'tabs' && cl_abap_char_utilities=>horizontal_tab ) TO lines.
          APPEND VALUE #( tdformat = '*' tdline = '  ' ) TO lines.
        WHEN 5.
          APPEND VALUE #( tdformat = '*' tdline = 'Grüße € — Καλημέρα Привет 日本語 العربية' ) TO lines.
          APPEND VALUE #( tdformat = '*' tdline = 'Emoji 😀 🧪 supplementary 𐐀' ) TO lines.
        WHEN 6.
          DO 500 TIMES.
            APPEND VALUE #( tdformat = '*' tdline = repeat( val = 'A' occ = 132 ) ) TO lines.
          ENDDO.
        WHEN 7 OR 8 OR 9.
          DATA(nrows) = SWITCH i( case_no WHEN 7 THEN 70 WHEN 8 THEN 500 ELSE 2000 ).
          DATA(seed) = CONV int8( 17012026 ).
          DATA alphabet TYPE string.
          alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 !#$%&()*+,-./:;<=>?@[]^_{|}~'.
          DO nrows TIMES.
            DATA(text) = ``.
            DO 132 TIMES.
              seed = ( seed * 48271 ) MOD 2147483647.
              DATA(idx) = CONV i( seed MOD strlen( alphabet ) ).
              text = text && substring( val = alphabet off = idx len = 1 ).
            ENDDO.
            APPEND VALUE #( tdformat = '*' tdline = text ) TO lines.
          ENDDO.
      ENDCASE.
      APPEND INITIAL LINE TO cases ASSIGNING FIELD-SYMBOL(<case>).
      <case>-name = |synthetic-{ case_no }|.
      <case>-expected = lines.
      DATA compressed TYPE xstring.
      DATA plain TYPE xstring.
      EXPORT tline = lines TO DATA BUFFER compressed COMPRESSION ON.
      EXPORT tline = lines TO DATA BUFFER plain COMPRESSION OFF.
      <case>-compressed = cl_http_utility=>encode_x_base64( compressed ).
      <case>-plain = cl_http_utility=>encode_x_base64( plain ).
      DATA(check) = lines.
      CLEAR check.
      IMPORT tline = check FROM DATA BUFFER compressed.
      ASSERT check = lines.
    ENDDO.
    DATA(writer) = cl_sxml_string_writer=>create( type = if_sxml=>co_xt_json ).
    CALL TRANSFORMATION id SOURCE cases = cases RESULT XML writer.
    out->write( cl_http_utility=>encode_x_base64( writer->get_output( ) ) ).
  ENDMETHOD.
ENDCLASS.
