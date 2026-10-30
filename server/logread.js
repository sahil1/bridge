// Agents' logs can be bigger than fits in one string (a Claude Code transcript can pass 500 MB:
// newer versions log every request they make), so they're read in pieces, without holding up the
// server.
import fs from 'node:fs'

const CHUNK = 2 * 1024 * 1024

// Reads a file from st.offset up to `size` (st = { offset, carry }), handing take() whole lines a
// piece at a time. st is left where it stopped, so keeping it and calling again later reads only
// what's been added since. take() returning true stops early.
export async function readAdded(st, file, size, take) {
  const fh = await fs.promises.open(file, 'r')
  const buf = Buffer.allocUnsafe(Math.max(1, Math.min(CHUNK, size - st.offset)))
  try {
    while (st.offset < size) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, size - st.offset), st.offset)
      if (!bytesRead) break
      st.offset += bytesRead
      const data = st.carry.length ? Buffer.concat([st.carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead)
      const nl = data.lastIndexOf(10)
      st.carry = Buffer.from(data.subarray(nl + 1)) // a copy: buf is read into again
      if (st.carry.length > 64 * 1024 * 1024) st.carry = Buffer.alloc(0) // a line this long isn't one anyone needs
      if (nl >= 0 && take(data.subarray(0, nl).toString('utf8'))) break
    }
  } finally { await fh.close() }
}

export async function readSlice(file, start, len) {
  const fh = await fs.promises.open(file, 'r')
  try {
    const buf = Buffer.alloc(len)
    const { bytesRead } = await fh.read(buf, 0, len, start)
    return buf.toString('utf8', 0, bytesRead)
  } finally { await fh.close() }
}

// The last `bytes` of a file of `size` bytes, as whole lines.
export async function tailLines(file, size, bytes) {
  const start = Math.max(0, size - bytes)
  const s = (await readSlice(file, start, size - start)).split('\n')
  if (start) s.shift()
  return s.filter(Boolean)
}
