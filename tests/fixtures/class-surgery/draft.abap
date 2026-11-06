CLASS zrace DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS target.
    METHODS added.
    METHODS other.
ENDCLASS.
CLASS zrace IMPLEMENTATION.
  METHOD target.
    DATA(value) = 'old'.
  ENDMETHOD.
  METHOD added.
  ENDMETHOD.
  METHOD other.
    DATA(value) = 'draft-other'.
  ENDMETHOD.
ENDCLASS.
