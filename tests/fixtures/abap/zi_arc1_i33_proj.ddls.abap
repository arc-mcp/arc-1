@EndUserText.label: 'ARC-1 FEAT-33 projection'
@AccessControl.authorizationCheck: #NOT_REQUIRED
define view entity ZI_ARC1_I33_PROJ as select from ZI_ARC1_I33_ROOT {
  key id,
  description
}
