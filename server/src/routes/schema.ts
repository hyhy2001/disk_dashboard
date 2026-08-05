// server/src/routes/schema.ts
export function envelope(data: object): any {
  return {
    type: 'object',
    properties: { status: { const: 'success' }, data },
    required: ['status', 'data'],
    additionalProperties: false,
  }
}

export function envelopeRef(): any {
  return envelope({ type: 'object', additionalProperties: true })
}

export function stringParam(name: string): any {
  return { type: 'object', properties: { [name]: { type: 'string' } }, required: [name] }
}

/** One route param, always a string (path segments arrive as strings). */
export function pathParams(required: string[]): any {
  return {
    type: 'object',
    properties: Object.fromEntries(required.map((n) => [n, { type: 'string' }])),
    required,
  }
}

/** A string query parameter, documented but unvalidated. */
export function stringQuery(name: string, description: string): any {
  return { type: 'string', description }
}

/** A numeric query parameter; the handler parses the raw string. */
export function intQuery(name: string, description: string): any {
  return { anyOf: [{ type: 'integer' }, { type: 'string' }], description }
}
