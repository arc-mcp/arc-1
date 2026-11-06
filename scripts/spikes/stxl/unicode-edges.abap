CLASS ZCL_ARC1_STXL_ORACLE DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION. INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS ZCL_ARC1_STXL_ORACLE IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    TYPES: BEGIN OF ty_case, name TYPE string, compressed TYPE string, plain TYPE string,
             expected_raw TYPE STANDARD TABLE OF string WITH EMPTY KEY, END OF ty_case.
    DATA cases TYPE STANDARD TABLE OF ty_case WITH EMPTY KEY.
    DATA lines TYPE STANDARD TABLE OF tline WITH EMPTY KEY.
    DATA line TYPE tline.
    FIELD-SYMBOLS <raw> TYPE x.
    DO 3 TIMES.
      DATA(case_no) = sy-index.
      CLEAR lines.
      CASE case_no.
        WHEN 1.
          line = VALUE #( tdformat = '*' tdline = repeat( val = 'A' occ = 131 ) && '😀' ).
          APPEND line TO lines.
          line = VALUE #( tdformat = '*' tdline = ' low surrogate at start' ).
          ASSIGN line-tdline TO <raw> CASTING.
          <raw>(2) = '00DE'.
          APPEND line TO lines.
        WHEN 2.
          line = VALUE #( tdformat = '*' tdline = 'ABC' ).
          ASSIGN line-tdline TO <raw> CASTING.
          <raw>+2(2) = '0000'.
          <raw>+262(2) = 'FFFF'.
          APPEND line TO lines.
        WHEN 3.
          APPEND VALUE #( tdformat = '*' tdline = 'trailing' && cl_abap_char_utilities=>horizontal_tab ) TO lines.
          APPEND VALUE #( tdformat = '*' tdline = |trailing | ) TO lines.
          APPEND VALUE #( tdformat = '*' tdline = |trailing　| ) TO lines.
      ENDCASE.
      APPEND INITIAL LINE TO cases ASSIGNING FIELD-SYMBOL(<case>).
      <case>-name = |unicode-edge-{ case_no }|.
      DATA compressed TYPE xstring.
      DATA plain TYPE xstring.
      EXPORT tline = lines TO DATA BUFFER compressed COMPRESSION ON.
      EXPORT tline = lines TO DATA BUFFER plain COMPRESSION OFF.
      DATA check TYPE STANDARD TABLE OF tline WITH EMPTY KEY.
      IMPORT tline = check FROM DATA BUFFER compressed.
      ASSERT check = lines.
      <case>-compressed = cl_http_utility=>encode_x_base64( compressed ).
      <case>-plain = cl_http_utility=>encode_x_base64( plain ).
      LOOP AT check ASSIGNING FIELD-SYMBOL(<line>).
        ASSIGN <line> TO <raw> CASTING.
        DATA(bytes) = CONV xstring( <raw> ).
        ASSERT xstrlen( bytes ) = 268.
        APPEND cl_http_utility=>encode_x_base64( bytes ) TO <case>-expected_raw.
      ENDLOOP.
    ENDDO.
    DATA(writer) = cl_sxml_string_writer=>create( type = if_sxml=>co_xt_json ).
    CALL TRANSFORMATION id SOURCE cases = cases RESULT XML writer.
    out->write( cl_http_utility=>encode_x_base64( writer->get_output( ) ) ).
  ENDMETHOD.
ENDCLASS.
