@EndUserText.label : 'ARC1 table graph EEE257AEFB75'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table zttgeee257aefb75 {

  key client : abap.clnt not null;
  key id     : abap.char(10) not null;
  status     : abap.char(1);

}