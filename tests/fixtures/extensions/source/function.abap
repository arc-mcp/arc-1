function sapbc_global_cancel_update
  importing
    value(iv_scarrid) type sbook-carrid
    value(iv_sconnid) type sbook-connid
    value(iv_sfldate) type sbook-fldate
    value(iv_sbookid) type sbook-bookid
    value(iv_sloccuram) type sbook-loccuram
    value(iv_class) type sbook-class.






update sbook
    set   cancelled = 'X'
    where carrid    = iv_scarrid
    and   connid    = iv_sconnid
    and   fldate    = iv_sfldate
    and   bookid    = iv_sbookid.

if sy-subrc <> 0.
  message a157.
endif.

* update SFLIGHT dpendent on class
case IV_CLASS.
  when 'Y'.
    update sflight
        set   seatsocc   = seatsocc - 1
              paymentsum = paymentsum - iv_sloccuram
        where carrid     = iv_scarrid
        and   connid     = iv_sconnid
        and   fldate     = iv_sfldate.
  when 'C'.
    update sflight
        set   seatsocc_b = seatsocc_b - 1
              paymentsum = paymentsum - iv_sloccuram
        where carrid     = iv_scarrid
        and   connid     = iv_sconnid
        and   fldate     = iv_sfldate.
  when 'F'.
    update sflight
        set   seatsocc_f = seatsocc_f - 1
              paymentsum = paymentsum - iv_sloccuram
        where carrid     = iv_scarrid
        and   connid     = iv_sconnid
        and   fldate     = iv_sfldate.
endcase.

if sy-subrc <> 0.
  message a158.
endif.


ENDFUNCTION.