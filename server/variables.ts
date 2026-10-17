// Masked values never go out in lists or broadcasts: a list response sits in browser memory and every
// open tab receives the SSE stream. The value is sent only by /variables/value, one variable per request.
export function redactVariable<T extends { masked: boolean; value: string }>(v: T): T & { value_hidden?: boolean } {
  return v.masked ? { ...v, value: '', value_hidden: true } : v;
}
