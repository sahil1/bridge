// Office's lock file beside a document it has open ("~$Report.docx", 165 bytes: who has it open),
// and LibreOffice's (".~lock.Report.docx#"). Never a document of yours: listed as hidden files are
// (only with Show hidden), never opened by Studio and never offered to a bot.
export const isLockFile = (name) => {
  const n = String(name || '').split(/[\\/]/).pop()
  return n.startsWith('~$') || /^\.~lock\..*#$/.test(n)
}
