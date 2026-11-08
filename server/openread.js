// Reading one of your files without it counting as opening it, where the system lets a reader say
// so (Linux's O_NOATIME, for a file that's yours). What Files shows (a picture's thumbnail, a video
// played, a document read or laid out, a copy sent to another device) and what Files Assist reads
// leave a forgotten file looking forgotten, and change nothing about it. Elsewhere (macOS notes a
// read only after a change, Windows doesn't by default), or for someone else's file, it's an
// ordinary read.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'

const NOATIME = fs.constants.O_NOATIME ? fs.constants.O_RDONLY | fs.constants.O_NOATIME : null
export const openToRead = (file) => (NOATIME ? fsp.open(file, NOATIME).catch((e) => (e.code === 'EPERM' ? fsp.open(file, 'r') : Promise.reject(e))) : fsp.open(file, 'r'))

export async function readWhole(file, encoding) {
  const fh = await openToRead(file)
  try { return await fh.readFile(encoding ? { encoding } : undefined) } finally { await fh.close().catch(() => {}) }
}

// A copy of it at `to` (in Bridge AI's own folder), for a program that would read it otherwise.
export async function copyOut(file, to) {
  const fh = await openToRead(file)
  await pipeline(fh.createReadStream(), fs.createWriteStream(to))
}
