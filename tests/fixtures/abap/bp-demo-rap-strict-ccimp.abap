CLASS lhc_DEMO_RAP_STRICT DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.


    METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION
      IMPORTING REQUEST requested_authorizations FOR demo_rap_strict RESULT result.

ENDCLASS.

CLASS lhc_DEMO_RAP_STRICT IMPLEMENTATION.

  METHOD get_global_authorizations.
  ENDMETHOD.

ENDCLASS.
