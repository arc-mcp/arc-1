CLASS zcl_extract_child DEFINITION INHERITING FROM zcl_extract_parent.
  PUBLIC SECTION.
    INTERFACES zif_extract.
ENDCLASS.
CLASS zcl_extract_child IMPLEMENTATION.
  METHOD zif_extract~run.
    cl_abap_context_info=>get_system_date( ).
    zcl_factory=>create( ).
    CALL FUNCTION 'Z_EXTRACT_FM'.
    " ZCL_COMMENT_CANARY=>never( ).
    DATA(marker) = 'ARC_SOURCE_CANARY_SECRET ZCL_LITERAL_CANARY=>NEVER( )'.
  ENDMETHOD.
ENDCLASS.
