*----------------------------------------------------------------------*
***INCLUDE LSEEF_ADT_TEST_AUNIT_FUGR1F01.
*----------------------------------------------------------------------*
*&---------------------------------------------------------------------*
*&      Form  fugr_form
*&---------------------------------------------------------------------*
*       text
*----------------------------------------------------------------------*
*  -->  p1        text
*  <--  p2        text
*----------------------------------------------------------------------*
form fugr_form_no_enh ##CALLED ##NEEDED.

endform.                    " fugr_form

form fugr_form_with_enh using param type i ##CALLED ##NEEDED.

    data(l_var) = param.

ENHANCEMENT-POINT FORM1 SPOTS SEEF_ADT_TEST_ENHS_2 .

   include seef_adt_test_aunit_include_3.

endform.