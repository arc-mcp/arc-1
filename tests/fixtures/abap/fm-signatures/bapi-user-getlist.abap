function bapi_user_getlist
  importing
    value(max_rows) type bapiusmisc-bapimaxrow default 0
    value(with_username) type bapiusmisc-with_name default space
  exporting
    value(rows) type bapiusmisc-bapirows
  tables
    selection_range like bapiussrge optional
    selection_exp like bapiussexp optional
    userlist like bapiusname optional
    return like bapiret2 optional.



*  04.08.2005 D034406 ( Note 826111 )                           6.20+
* new functionality in BAPI_USER_GETLIST for LASTMODIFIED, ISLOCKED and
* SYSTEM
*-----------------------------------------------------------------------
*  18.08.2008 D034973 note 1242247                               6.20+
* Dump for SELECT statmant with more then 2000 entries
* in the WHERE-TAB.
*---------------------------------------------------------------------*
*
* Search of user ID's by specific fields.
*
* Supported field
*   - 15.8.2003
*   - Important fields of BAPI_USER_GET_DETAIL:
*
*   PARAMETER       FIELD
*   --------------------------------
*   USERNAME
*   LOGONDATA       GLTGV, GLTGB, USTYP, CLASS, ACCNT, TZONE, CODVN,
*                   UFLAG (not in BAPI_USER_GET_DETAIL, that shows
*                          this information in parameter ISLOCKED)
*                   SECURITY_POLICY
*   DEFAULTS        SPLD,  SPLG,  SPDB,  SPDA,  DATFM, DCPFM, LANGU,
*                   KOSTL, START_MENU, TIMEFM, TZONE_IANA
*   REF_USER        REF_USER
*   ALIAS           USERALIAS
*   GROUPS          USERGROUP
*   PROFILES        BAPIPROF
*   LOCPROFILES     SUBSYSTEM, PROFILE
*   ACTIVITYGROUPS  AGR_NAME, FROM_DAT, TO_DAT
*   LOCACTGROUPS    SUBSYSTEM, AGR_NAME, FROM_DAT, TO_DAT
*   ADDRESS         FIRSTNAME, LASTNAME,   DEPARTMENT, INHOUSE_ML,
*                   FUNCTION,  BUILDING_P, BUILDING,   ROOM_NO_P,
*                   TEL1_EXT,  TEL1_NUMBR, FAX_EXTENS, FAX_NUMBER
*                   E_MAIL
*   COMPANY         COMPANY
*   LASTMODIFIED    MODDATE, MODTIME
*                   MODIFIER                (Release >=710 )
*   ISLOCKED        LOCAL_LOCK, GLOB_LOCK, WRNG_LOGON, NO_USER_PW
*   SYSTEM          SUBSYSTEM
*   IDENTITY        IDENTITY_UUID BPPERSON  (Release >=710 )
*   ADMINDATA       ANAME ERDAT TRDAT CUA_LOCAL_USER  (Release >=710 )
*   TECH_USER       TECH_INDICATOR, IDADTYPE
*   SAPUSER_UUID    SAP_UID
*   USATTRIBUTE     ATTR_TYPE, ATTR_ID
*-----------------------------------------------------------------------


  data: lt_selection          type          suid_tt_search_node_fields
      , ls_selection          type          suid_st_search_node_field
      , ls_query_options      type          suid_st_query_options
      , lo_msg_buffer         type ref to   if_suid_msg_buffer
      , ls_search_info        type          suid_st_query_info
      , lt_search_result      type          suid_tt_search_result
      , lr_search_result      type ref to   suid_st_search_result
      , ls_bapi_result        type          bapiusname
      , lt_return             type          bapirettab
      , lt_messages           type          if_suid_msg_buffer=>tt_messages
      , lx_suid_identity      type ref to   cx_suid_identity
      , ls_return             type          bapiret2
      , lr_select_range       type ref to   bapiussrge
      , lr_select_exp         type ref to   bapiussexp
      , lt_select_exp         type          suid_tt_select_expressions
      , ls_select_exp         type          suid_st_select_expression
      , lo_persistence        type ref to   cl_identity_persistence
      , ls_msg                type          symsg
      .


  " -- Authority check --
  try.
      cl_suid_tools=>auth_check_single(
        exporting
          iv_nodename  = if_identity_definition=>gc_node_root
          iv_operation = cl_suid_tools=>co_activity_retrieve
          iv_class     = space
        importing
          es_msg       = ls_msg ).
    catch  cx_suid_identity.
      ls_msg-msgty = 'E'.
  endtry.
  if ls_msg-msgty eq 'E'.
    " Keine Berecht. zum Anzeigen Benutzer
    if 1 = 2. message e495(01). endif.
    call function 'BALW_BAPIRETURN_GET2'
      exporting
        type   = 'E'
        cl     = '01'
        number = '495'
      importing
        return = ls_return.
    append ls_return to return.
    exit.
  endif.


  " -- Search --
  clear: return[], userlist[], rows, lt_return.
  try.
      " --- set query options
      ls_query_options-maximum_rows = max_rows.
      ls_query_options-with_name    = with_username.
      ls_query_options-with_uuid    = space.

      " --- prepare call of identity search
      if not selection_range[] is initial.
        loop at selection_range reference into lr_select_range.
          clear: ls_selection, ls_return.
          " Mapping of BAPI search structure to identity node
          call method cl_suid_tools=>map_bapi_search_to_node
            exporting
              iv_parameter  = lr_select_range->parameter
              iv_field      = lr_select_range->field
            importing
              ev_node_name  = ls_selection-node_name
              ev_field_name = ls_selection-field_name
            changing
              cv_low        = lr_select_range->low
              cv_high       = lr_select_range->high
              cs_return     = ls_return.

          ls_selection-sign       = lr_select_range->sign.
          ls_selection-option     = lr_select_range->option.
          ls_selection-low        = lr_select_range->low.
          ls_selection-high       = lr_select_range->high.

          insert ls_selection into table lt_selection.

          if ls_return is not initial.
            append ls_return to lt_return.
          endif.

        endloop.

      elseif selection_exp[] is not initial.
        " --- prepare call of identity select expression

        loop at selection_exp reference into lr_select_exp.
          clear: ls_select_exp, ls_return.

          " Mapping of BAPI search structure to identity node
          call method cl_suid_tools=>map_bapi_search_to_node
            exporting
              iv_parameter  = lr_select_exp->parameter
              iv_field      = lr_select_exp->field
            importing
              ev_node_name  = ls_select_exp-node_name
              ev_field_name = ls_select_exp-field_name
            changing
              cv_low        = lr_select_exp->low
              cv_high       = lr_select_exp->high
              cs_return     = ls_return.

          ls_select_exp-logop      = lr_select_exp->logop.
          ls_select_exp-arity      = lr_select_exp->arity.
          ls_select_exp-option     = lr_select_exp->option.
          ls_select_exp-low        = lr_select_exp->low.
          ls_select_exp-high       = lr_select_exp->high.

          insert ls_select_exp into table lt_select_exp.

          if ls_return is not initial and ls_select_exp-logop is initial.
            append ls_return to lt_return.
          endif.

        endloop.

      endif.

      if lt_return is not initial.
        append lines of lt_return to return.
        return.
      endif.

      " --- call identity search
      cl_identity_persistence=>get_instance(
      importing
        ecl_persistence = lo_persistence ).

      lo_persistence->if_suid_persistence_query~search(
        exporting
          it_select_expression    = lt_select_exp
          it_selection_parameters = lt_selection
          is_query_options        = ls_query_options
        importing
          eo_msg_buffer           = lo_msg_buffer
          es_query_info           = ls_search_info
          et_search_result        = lt_search_result ).


      " --- prepare search result
      loop at lt_search_result reference into lr_search_result.
        clear ls_bapi_result.
        ls_bapi_result-username   = lr_search_result->username.
        ls_bapi_result-firstname  = lr_search_result->firstname.
        ls_bapi_result-lastname   = lr_search_result->lastname.
        ls_bapi_result-fullname   = lr_search_result->fullname.
        insert ls_bapi_result into table userlist.
      endloop.

      rows = ls_search_info-count.

    catch cx_suid_identity into lx_suid_identity.
      call method cl_identity_tools=>message_suid_technical_error
        importing
          es_return = ls_return.
      append ls_return to return.

  endtry.

  " Finally, perform evaluation of message buffer and append to return
  call method cl_identity_tools=>msg_buffer_retrieve
    exporting
      iv_bname             = space
      io_msg_buffer        = lo_msg_buffer
      iv_lifetimeonce_only = if_identity=>co_false
    changing
      ct_messages          = lt_messages.

  call method cl_identity_tools=>msg_buffer_convert_to_bapiret2
    exporting
      it_messages = lt_messages
    importing
      et_return   = lt_return.

  append lines of lt_return to return.


endfunction.