@EndUserText.label : 'ARC-1 FEAT-33 table'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table ZTABL_ARC1_I33 {
  key client      : abap.clnt not null;
  key id          : abap.numc(8) not null;
  description     : abap.char(80);
  created_at      : abap.tims;
}
