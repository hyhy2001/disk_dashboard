#!/usr/bin/env tsx
// CLI admin tool — seed, list, reset-password, delete, migrate

import { resolve } from 'node:path'
import {
  adminDb, closeAdminDb, createAdmin, listAdmins, deleteAdmin,
  changePassword, hasAnyAdmin, getAdminByUsername,
  createSpace, createDisk, listSpaces,
} from './db/admin.js'

const cmd = process.argv[2]
const args = process.argv.slice(3)

function usage(): void {
  console.error(`
Usage: npx tsx src/cli.ts <command> [options]

Admin management:
  seed <username> <password>     Create the first admin account (owner)
  list                           List all admin accounts
  reset-password <username> <pwd> Reset a user password
  rm <username>                  Delete an admin (cannot delete last owner)
  setup-status                   Check if admin accounts exist

Space/disk management:
  add-space <name>               Create a space
  list-spaces                    List all spaces
  add-disk <space-id> <name> <path> Add a disk to a space
`)
  process.exit(1)
}

if (!cmd) usage()

// Ensure DB is initialized
adminDb()

function main(): void {
  switch (cmd) {
    case 'seed': {
      const [user, pass] = args
      if (!user || !pass) { console.error('Usage: seed <username> <password>'); process.exit(1) }
      if (hasAnyAdmin()) { console.error('Admin accounts already exist. Use reset-password to change password.'); process.exit(1) }
      const admin = createAdmin(user, pass, 'owner')
      console.log(`Owner created: id=${admin.id} username=${admin.username} role=${admin.role}`)
      console.log(`Visit https://dashboard.hydev.me/admin to manage spaces and disks`)
      break
    }
    case 'list': {
      const admins = listAdmins()
      if (admins.length === 0) { console.log('No admin accounts. Run seed to create one.'); break }
      for (const a of admins) console.log(`${a.id}\t${a.role}\t${a.username}\t${a.created_at}`)
      break
    }
    case 'reset-password': {
      const [user, pass] = args
      if (!user || !pass) { console.error('Usage: reset-password <username> <password>'); process.exit(1) }
      const admin = getAdminByUsername(user)
      if (!admin) { console.error(`Admin "${user}" not found`); process.exit(1) }
      changePassword(admin.id, pass)
      console.log(`Password reset for ${user}`)
      break
    }
    case 'rm': {
      const [user] = args
      if (!user) { console.error('Usage: rm <username>'); process.exit(1) }
      const admin = getAdminByUsername(user)
      if (!admin) { console.error(`Admin "${user}" not found`); process.exit(1) }
      if (deleteAdmin(admin.id)) console.log(`Deleted ${user}`)
      else console.error(`Cannot delete: ${user} is the last owner`)
      break
    }
    case 'setup-status': {
      console.log(hasAnyAdmin() ? 'Setup complete' : 'No admin accounts — visit /admin to set up')
      break
    }
    case 'add-space': {
      const [name] = args
      if (!name) { console.error('Usage: add-space <name>'); process.exit(1) }
      const space = createSpace(name)
      console.log(`Space created: id=${space.id} name=${space.name}`)
      break
    }
    case 'list-spaces': {
      const spaces = listSpaces()
      if (spaces.length === 0) { console.log('No spaces defined'); break }
      for (const s of spaces) console.log(`${s.id}\t${s.name}\t(sort=${s.sort_order})`)
      break
    }
    case 'add-disk': {
      const [sid, name, path] = args
      if (!sid || !name || !path) { console.error('Usage: add-disk <space-id> <name> <path>'); process.exit(1) }
      const disk = createDisk(Number(sid), name, resolve(path))
      console.log(`Disk created: id=${disk.id} name=${disk.name} path=${disk.path}`)
      break
    }
    default:
      usage()
  }
  closeAdminDb()
}

main()
