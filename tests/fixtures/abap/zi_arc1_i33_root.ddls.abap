@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'ARC-1 FEAT-33 root view'
define view entity ZI_ARC1_I33_ROOT as select from ztabl_arc1_i33 {
  key id,
  description,
  created_at
}
