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
  // The data payload is deliberately untyped: several endpoints return arrays
  // (targets, users, statuses) and Fastify's fast-json-stringify would mangle an
  // array under a `type: 'object'` property, so any-typed is the safe shape.
  return envelope({})
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
