CLASS ZCL_ARC1_STXL_ORACLE DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION. INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS ZCL_ARC1_STXL_ORACLE IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    TYPES: BEGIN OF ty_case,
             name TYPE string, status TYPE i, chunks TYPE i,
             compressed TYPE string, expected TYPE STANDARD TABLE OF tline WITH EMPTY KEY,
           END OF ty_case.
    DATA cases TYPE STANDARD TABLE OF ty_case WITH EMPTY KEY.
    DATA keys TYPE STANDARD TABLE OF stxl WITH EMPTY KEY.
    SELECT * FROM stxl UP TO 60 ROWS INTO TABLE keys WHERE relid = 'TX' AND srtf2 = 0.
    LOOP AT keys ASSIGNING FIELD-SYMBOL(<key>).
      APPEND INITIAL LINE TO cases ASSIGNING FIELD-SYMBOL(<case>).
      <case>-name = |legacy-corpus-{ sy-tabix }|.
      CALL FUNCTION 'READ_TEXT'
        EXPORTING object = <key>-tdobject name = <key>-tdname id = <key>-tdid language = <key>-tdspras
        TABLES lines = <case>-expected EXCEPTIONS OTHERS = 8.
      <case>-status = sy-subrc.
      IF lines( <case>-expected ) > 3000.
        CLEAR <case>-expected. <case>-status = 99. CONTINUE.
      ENDIF.
      DATA parts TYPE STANDARD TABLE OF stxl WITH EMPTY KEY.
      SELECT * FROM stxl INTO TABLE parts WHERE relid = 'TX' AND tdobject = <key>-tdobject
        AND tdname = <key>-tdname AND tdid = <key>-tdid AND tdspras = <key>-tdspras.
      SORT parts BY srtf2.
      DATA cluster TYPE xstring.
      CLEAR cluster.
      LOOP AT parts ASSIGNING FIELD-SYMBOL(<part>).
        CONCATENATE cluster <part>-clustd(<part>-clustr) INTO cluster IN BYTE MODE.
      ENDLOOP.
      <case>-compressed = cl_http_utility=>encode_x_base64( cluster ).
      <case>-chunks = lines( parts ).
    ENDLOOP.
    DATA(writer) = cl_sxml_string_writer=>create( type = if_sxml=>co_xt_json ).
    CALL TRANSFORMATION id SOURCE cases = cases RESULT XML writer.
    out->write( cl_http_utility=>encode_x_base64( writer->get_output( ) ) ).
  ENDMETHOD.
ENDCLASS.
