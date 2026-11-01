function seef_adt_test_aunit_fmodule1.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     REFERENCE(I_PARAM) TYPE  I DEFAULT 100
*"----------------------------------------------------------------------

  data(l_int) = i_param.

ENHANCEMENT-SECTION ENHS1 SPOTS SEEF_ADT_TEST_ENHS_2 .

  if l_int > 100.

    data(l_str) = |not enhanced| ##NEEDED.

  endif.

     end-enhancement-section.

endfunction.