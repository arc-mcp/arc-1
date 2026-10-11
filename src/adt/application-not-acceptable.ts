/**
 * True when a 406 body is an SAP exception carrying an application message, i.e. a T100 key
 * outside SADT_RESOURCE (the ADT resource framework, which owns the real negotiation message
 * 044 "The message content is not acceptable. Accepted content types: …").
 *
 * Some services answer a validation failure with 406 as well, under the same exception type
 * ExceptionResourceNotAcceptable: the textelements service refuses a selection text over 30
 * characters with SEDX_ADT/110 "Length of text symbol R_SUBMIT exceeds 30 characters". A retry
 * with another Accept cannot change that answer; it only repeats the write.
 */
export function isApplicationNotAcceptable(body: string): boolean {
  const id = body.match(/<entry\s+key="T100KEY-(?:MSG)?ID">([^<]+)<\/entry>/i)?.[1]?.trim();
  return !!id && id.toUpperCase() !== 'SADT_RESOURCE';
}
