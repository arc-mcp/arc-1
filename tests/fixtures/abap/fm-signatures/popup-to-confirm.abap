FUNCTION POPUP_TO_CONFIRM
  IMPORTING
    VALUE(TITLEBAR) TYPE ANY DEFAULT SPACE ##ADT_PARAMETER_UNTYPED
    VALUE(DIAGNOSE_OBJECT) LIKE DOKHL-OBJECT DEFAULT SPACE
    VALUE(TEXT_QUESTION) TYPE ANY ##ADT_PARAMETER_UNTYPED
    VALUE(TEXT_BUTTON_1) TYPE ANY DEFAULT 'Ja'(001) ##ADT_PARAMETER_UNTYPED
    VALUE(ICON_BUTTON_1) LIKE ICON-NAME DEFAULT SPACE
    VALUE(TEXT_BUTTON_2) TYPE ANY DEFAULT 'Nein'(002) ##ADT_PARAMETER_UNTYPED
    VALUE(ICON_BUTTON_2) LIKE ICON-NAME DEFAULT SPACE
    VALUE(DEFAULT_BUTTON) TYPE ANY DEFAULT '1' ##ADT_PARAMETER_UNTYPED
    VALUE(DISPLAY_CANCEL_BUTTON) TYPE ANY DEFAULT 'X' ##ADT_PARAMETER_UNTYPED
    VALUE(USERDEFINED_F1_HELP) LIKE DOKHL-OBJECT DEFAULT SPACE
    VALUE(START_COLUMN) LIKE SY-CUCOL DEFAULT 25
    VALUE(START_ROW) LIKE SY-CUROW DEFAULT 6
    VALUE(POPUP_TYPE) LIKE ICON-NAME OPTIONAL
    IV_QUICKINFO_BUTTON_1 TYPE TEXT132 DEFAULT SPACE
    IV_QUICKINFO_BUTTON_2 TYPE TEXT132 DEFAULT SPACE
  EXPORTING
    VALUE(ANSWER) TYPE ANY ##ADT_PARAMETER_UNTYPED
  TABLES
    PARAMETER LIKE SPAR OPTIONAL
  EXCEPTIONS
    TEXT_NOT_FOUND.



*
  DATA: overlay_header LIKE thead,                          "*029u
*       l_parameter    LIKE spar OCCURS 0 WITH HEADER LINE. "*029d
        l_quickinfo_button_1 TYPE TEXT132 VALUE SPACE,
        l_quickinfo_button_2 TYPE TEXT132 VALUE SPACE,
        l_QUICKINFO_BUTTON_3 TYPE TEXT132 VALUE SPACE,
        l_QUICKINFO_BUTTON_4 TYPE TEXT132 VALUE SPACE.
* Initialisieren der Parameter
  answer = 'A'.
  CLEAR:   button_1, button_2, button_3, button_4.
  CLEAR:   dynp_loops.

  CLEAR:   text_tab1, text_tab2, textlines, exclude.
  REFRESH: text_tab1, text_tab2, textlines, exclude.

  title             = titlebar.                             "B20K071317
  fragetext         = text_question.
  MOVE text_button_1 TO button_1(12).
  MOVE text_button_2 TO button_2(12).
  option            = default_button.
  cancel_option     = display_cancel_button.
  userdefined_f1_id = userdefined_f1_help.
  start_zeile       = start_row.
  start_spalte      = start_column.
  text_tab2_index   = 1.
  icon_popup_type   = popup_type.                           "B20K062151

* Typ des Popup bestimmen                                  "B20K062151
  PERFORM type_of_popup CHANGING icon_popup_type.           "B20K062151

* Der folgende Parameter hält die Fensterbreite variabel.
  IF userdefined_f1_id NE space.
    textlength = 57.
  ELSE.
    textlength = 48.
  ENDIF.

*015i+
* Parameterliste sortieren
  IF NOT parameter[] IS INITIAL.
    MOVE parameter[] TO l_parameter[].
    LOOP AT l_parameter.                                    "*034i
      SHIFT l_parameter-value LEFT DELETING LEADING space.  "*034i
      MODIFY l_parameter.                                   "*034i
    ENDLOOP.                                                "*034i
    SORT l_parameter.
  ENDIF.
*015i-

**Inhalt des Textbausteins beschaffen
  IF diagnose_object NE space.
    CALL FUNCTION 'DOCU_GET_FOR_F1HELP'
      EXPORTING
        id       = docu_id_dialog_text
        langu    = sy-langu
        object   = diagnose_object
      IMPORTING
        head     = overlay_header
      TABLES
        line     = textlines
      EXCEPTIONS
        ret_code = 04.
    if sy-subrc = 4.
        MOVE text-101 TO textlines-tdline.                  "B20K074949
        APPEND textlines.                                   "B20K074949
        CLEAR textlines.                                    "B20K074949
        APPEND textlines.                                   "B20K074949
    else.
*     Auflösen von eingebundenen Verweisen.
*     Bei Änderungen eines SE61 Textes auf dem Kundensystem
*     wird für die Erweiterung ein neues Dokument angelegt.
*     Im Originaldokument wird lediglich ein Verweis hinterlegt.
      call function 'TEXT_INCLUDE_REPLACE'                "B20K103456
        exporting
          header = overlay_header
        tables
          lines  = textlines.
*     Auflösen von Steuerelmenten (IF/ELSE/CASE)
      call function 'TEXT_CONTROL_REPLACE'                "B20K103456
        exporting
          header = overlay_header
        tables
          lines  = textlines.
*     Kommandozeilen löschen
      loop at textlines where tdformat = '/:'.            "B20K103456
        delete textlines.
      endloop.
    endif.

*   Parameter in den Diagnosetext einfügen
    IF NOT parameter[] IS INITIAL.
*015d+
* Diese Sortierung muß vorverlegt werden, da sie später
* außerhalb der IF-ENDIF-Abfrage nochmals benötigt wird.
*      MOVE parameter[] TO l_parameter[].
*      SORT l_parameter.
*015d-
      PERFORM insert_params TABLES textlines l_parameter.
    ENDIF.

*   Umsetzen des Dokuments aus der SE 61 in eine interne Tabelle.
    PERFORM move_docu_to_itab TABLES textlines text_tab2.

  ENDIF.

*015i+
* Parameter in den Fragetext schreiben.
  IF NOT l_parameter[] IS INITIAL.
    PERFORM replace_parameters TABLES   l_parameter
                               CHANGING fragetext.
  ENDIF.
*015i-

**Initialisieren der Drucktasten
  IF display_cancel_button = space.
    MOVE 'CANC' TO exclude.
    APPEND exclude.
  ENDIF.
  IF userdefined_f1_id NE space.
    icon_button_3 = 'ICON_INFORMATION'.
    button_3 = 'Info'(201).
    IF display_cancel_button = 'X'.
      icon_button_4 = 'ICON_CANCEL'.
      button_4 = 'Abbrechen'(200).
    ENDIF.
  ELSEIF display_cancel_button = 'X'.
    icon_button_3 = 'ICON_CANCEL'.
    button_3 = 'Abbrechen'(200).
  ENDIF.

* Belegen der Drucktasten mit Icons
  IF icon_button_1 NE space.
    IF iv_quickinfo_button_1 is not initial.                "974439  >>
      PERFORM append_icon_to_button
              USING    icon_button_1
                       iv_quickinfo_button_1                "*048i
              CHANGING button_1.
    else.
      MOVE button_1 to l_quickinfo_button_1.
      PERFORM append_icon_to_button
              USING    icon_button_1
                       l_quickinfo_button_1                 "*048i
              CHANGING button_1.
    endif.
  ELSE.
    IF NOT iv_quickinfo_button_1 IS INITIAL.
    PERFORM append_quickinfo_to_button                      "*048i
            USING    iv_quickinfo_button_1                  "*048i
            CHANGING button_1.                              "*048i
     ELSE.
       MOVE button_1 to l_quickinfo_button_1.
       PERFORM append_quickinfo_to_button
         USING    l_quickinfo_button_1
         CHANGING button_1..
     ENDIF.
  ENDIF.

  IF icon_button_2 NE space.
    IF iv_quickinfo_button_2 is not initial.
    PERFORM append_icon_to_button
            USING    icon_button_2
                     iv_quickinfo_button_2                  "*048i
              CHANGING button_2.
    else.
      MOVE button_2 to l_quickinfo_button_2.
      PERFORM append_icon_to_button
              USING    icon_button_2
                       l_quickinfo_button_2                 "*048i
              CHANGING button_2.
    endif.
  ELSE.
    IF NOT iv_quickinfo_button_2 IS INITIAL.
    PERFORM append_quickinfo_to_button                      "*048i
            USING    iv_quickinfo_button_2                  "*048i
            CHANGING button_2.                              "*048i
     ELSE.
       MOVE button_2 to l_quickinfo_button_2.
       PERFORM append_quickinfo_to_button
         USING    l_quickinfo_button_2
         CHANGING button_2.
     ENDIF.
  ENDIF.
  IF icon_button_3 NE space.
    MOVE button_3 to l_quickinfo_button_3.
    PERFORM append_icon_to_button
            USING    icon_button_3
                     l_quickinfo_button_3                  "*048i
            CHANGING button_3.
  ENDIF.
  IF icon_button_4 NE space.
    MOVE button_4 to l_quickinfo_button_4.
    PERFORM append_icon_to_button
            USING    icon_button_4
                     l_quickinfo_button_4                  "*048i
            CHANGING button_4.
  ENDIF.                                                   "974439  <<


* Aufbereitung des Fragetextes und Berechnung der Dynprogröße
  PERFORM format_text TABLES text_tab1
                      USING fragetext.

  PERFORM calculate_screen_size
              USING
                 textlength
                 start_spalte
                 start_zeile
              CHANGING
                 tab_len1
                 tab_len2
                 end_spalte
                 end_zeile
                 dynpro_nummer.


* Aufruf der Dialog-Dynpros

  CALL SCREEN dynpro_nummer STARTING AT start_spalte start_zeile
                            ENDING   AT end_spalte   end_zeile.


  answer = antwort.
ENDFUNCTION.
