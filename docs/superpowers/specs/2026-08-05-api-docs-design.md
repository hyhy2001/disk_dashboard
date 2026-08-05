# Auto API docs (OpenAPI 3.1, admin-gated)

## Purpose

Serve auto-generated, interactive API documentation for the Fastify server
(`/documentation`), covering all 34 routes with request/response shapes.
Access is restricted to admin sessions.

## Decisions (from brainstorming)

- **Detail level**: full — every route gets a JSON Schema (`params`,
  `querystring`, `body`, `response`), so @fastify/swagger generates useful docs.
- **Access**: admin-only. The report API itself stays public (unchanged), but
  the docs UI + OpenAPI JSON — which reveal the whole surface including admin
  endpoints and rate-limit internals — require a valid admin session.
- **Approach**: `@fastify/swagger` (OpenAPI 3.1 dynamic mode) +
  `@fastify/swagger-ui`. Plain JSON Schema objects (no Typebox refactor);
  routes keep their loose `req: any` typings.

## Components

### Dependencies (`server/package.json`)
- `@fastify/swagger` ^9 (Fastify 5 compatible)
- `@fastify/swagger-ui` ^5 (Fastify 5 compatible)

### `server/src/index.ts`
- Register `fastifySwagger` with info: title "Disk Dashboard API", version from
  `server/package.json`.
- Register `fastifySwaggerUi` with `routePrefix: '/documentation'` and a
  sensible `uiConfig` (e.g. `docExpansion: 'list'`).
- Add an `onRequest` hook that gates every URL under `/documentation`
  (the UI HTML, its static assets, and `/documentation/json`) behind an admin
  session: read `du_sess` cookie → `verifySession` → re-check the live admin
  row (username/role/session_version, same as `authUser` in
  `server/src/routes/admin.ts`). Unauthorized → `401`.

### Shared session check
- Extract the existing session-verification logic from `routes/admin.ts`
  (`authUser`) into a new `server/src/auth.ts` module exporting
  `adminSessionUser(request): AuthUser | null`. Both the admin routes
  (`requireAuth`/`requireOwner`) and the docs gate hook in `index.ts` use it,
  so there is a single implementation.

### Route schemas (`routes/api.ts`, `routes/admin.ts`)
- Add `schema` to all 34 routes.
- **Request schemas** — documented, but permissive enough that Fastify's
  newly-active validation never rejects input the current code accepts:
  - `params`: object with `type: 'string'` properties (path segments arrive as
    strings).
  - `querystring`: object with described properties, typed `string` where the
    handler parses the raw string (numbers arrive as strings; the code already
    tolerates garbage and falls back), or `anyOf` where a real type helps.
  - Admin `body`: object with typed known properties plus
    `additionalProperties: true`, so extra/unknown fields stay accepted.
- **Response schemas**:
  - A shared `envelope(data)` helper producing `{ status, data }` with `status`
    as enum `['success']` and `data` as the endpoint shape.
  - Endpoint-specific data shapes for the main GETs: health, targets, groups,
    overview, users, detail (dirs/files pages), treemap, history, inodes,
    permissions, search, statuses, export.
  - Admin endpoints: spaces, accounts, teams, backups, stats, auth status.
  - Long-tail/uncharted shapes fall back to a generic `{ type: 'object' }`.
- **Helper module** `server/src/routes/schema.ts`: `envelope(data)`, common
  param/querystring snippets, response-shape constants, to keep the 34 edits
  DRY.

### Error handling
- No new error paths beyond the `401` gate; swagger plugins are read-only.
- If any schema would reject input the current handler accepts, the route-layer
  tests catch it and the schema is loosened (permissive rule wins).

### Testing
- New route-layer tests:
  - `GET /documentation` → `401` without a session, `200` with a valid admin
    session.
  - The OpenAPI JSON (`/documentation/json`) contains expected paths
    (e.g. `/api/health`, `/api/users/:target`, `/api/admin/login`).
- Existing 338 unit tests must stay green (schemas must not change validation
  behavior).

## Non-goals
- No Typebox / typed-route refactor.
- No change to public report endpoints or their auth model.
- No changes to the `shared/api.ts` contract.
