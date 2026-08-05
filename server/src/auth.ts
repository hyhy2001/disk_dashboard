// Shared session handling for admin authentication.
//
// Session: a signed cookie `du_sess` carrying `adminId:role:username:session_version`.
// The HMAC-based signature (rather than a random token) means the server
// can validate the session without a session store — stateless, like JWT
// but simpler.

import { getAdminById, verifySession } from './db/admin.js'

export interface AuthUser {
  id: number
  username: string
  role: string
}

export const SESSION_COOKIE = 'du_sess'

/** Parse a numeric id strictly: '12garbage' must not read as 12. */
function intParam(raw: string): number {
  return /^\d+$/.test(raw) ? Number(raw) : 0
}

/**
 * Resolve the session cookie to a live admin row, or null.
 *
 * The cookie is HMAC-signed (so it cannot be forged) and carries an expiry, but
 * neither of those revokes a session when the account is deleted, demoted, or
 * has its password changed. Every request therefore re-checks the cookie against
 * the live admin row: the account must still exist with the same username, role,
 * and session_version, or the cookie is dead.
 */
export function adminSessionUser(request: { cookies?: Record<string, string | undefined> }): AuthUser | null {
  const raw = request.cookies?.[SESSION_COOKIE]
  if (!raw) return null
  const payload = verifySession(raw)
  if (!payload) return null
  const parts = payload.split(':')
  const idStr = parts[0]!
  const role = parts[1]
  const username = parts[2]
  const versionStr = parts[3]
  const id = intParam(idStr)
  if (!id || !role || !username) return null

  const row = getAdminById(id)
  if (!row) return null
  if (row.username !== username || row.role !== role) return null
  if (Number(versionStr) !== row.session_version) return null
  return { id, username: row.username, role: row.role }
}
