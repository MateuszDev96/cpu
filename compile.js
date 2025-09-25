#!/usr/bin/env node
const fs   = require('fs')
const path = require('path')

// Parse command-line arguments
const argv = process.argv.slice(2)
if (argv.length < 1) {
  console.error(`Usage: ${path.basename(process.argv[1])} <source.s> [--out main.hex] [--pad N]`)
  process.exit(1)
}

let srcFile = argv[0]
let outFile = 'main.hex'
let pad      = 0

for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--out' && i + 1 < argv.length) {
    outFile = argv[++i]
  }
  else if (argv[i] === '--pad' && i + 1 < argv.length) {
    pad = parseInt(argv[++i], 10) || 0
  }
}

// Utility: parse register name r0..r7
function regnum(r) {
  let m = /^([rR]?)([0-7])$/.exec(r)
  if (!m) throw new Error(`Bad register: ${r}`)
  return Number(m[2])
}

// Utility: parse immediate literal
function parseImm(s) {
  s = s.trim()
  if (/^0x/i.test(s))      return BigInt(s)
  if (/^[01]+b$/i.test(s)) return BigInt('0b' + s.slice(0, -1))
  return BigInt(s)
}

// Utility: unescape things like "\n", "\u1234"
function unescapeString(str) {
  // JSON.parse on a quoted string will unescape escapes
  return JSON.parse(`"${str.replace(/"/g, '\\"')}"`)
}

// Read and strip comments
function readSource(fname) {
  let lines = fs.readFileSync(fname, 'utf8').split(/\r?\n/)
  return lines.map(ln => {
    let orig = ln.replace(/\r?\n$/, '')
    let code = ln.split(/[#;]/, 1)[0]
    return [orig, code]
  })
}

// First pass: collect labels, expand .string/.asciz/.halt
function firstPass(lines) {
  let labels   = {}
  let expanded = []
  let pc        = 0

  for (let [orig, code] of lines) {
    let s = code.trim()
    if (!s) continue

    // Label?
    if (/^\.?[A-Za-z_]\w*:$/.test(s)) {
      let lab = s.slice(0, -1)
      if (labels.hasOwnProperty(lab)) {
        throw new Error(`Duplicate label ${lab}`)
      }
      labels[lab] = pc
      continue
    }

    // .string / .asciz
    let m = /^\.(string|asciz)\s+"(.*)"\s*$/.exec(s)
    if (m) {
      let kind = m[1]
      let raw  = m[2]
      let txt  = unescapeString(raw)
      for (let ch of txt) {
        expanded.push(['BYTE', ch])
        pc += 2
      }
      if (kind === 'asciz') {
        expanded.push(['BYTE', '\x00'])
        pc += 2
      }
      continue
    }

    // .halt
    if (s.toLowerCase() === '.halt') {
      expanded.push(['HALT', null])
      pc += 1
      continue
    }

    // Ordinary instruction
    expanded.push(['INST', s])
    pc += 1
  }

  return { expanded, labels }
}

// Emit 64-bit instruction word as BigInt
const MASK64 = (1n << 64n) - 1n
function emitInstWord(opcode, rd = 0, rs = 0, imm16 = 0n) {
  let w =  (BigInt(opcode & 0xF) << 60n)
         | (BigInt(rd & 0x7)       << 57n)
         | (BigInt(rs & 0x7)       << 54n)
         | (imm16 & 0xFFFFn)
  return w & MASK64
}

// Second pass: assemble instructions into words
function secondPass(expanded, labels) {
  let outwords = []
  let pc       = 0

  for (let [kind, payload] of expanded) {
    if (kind === 'BYTE') {
      let val = BigInt(payload.charCodeAt(0))
      // LI r0, val
      outwords.push(emitInstWord(0x3, 0, 0, val))
      // ST r0, 0xFF
      outwords.push(emitInstWord(0x5, 0, 0, 0xFFn))
      pc += 2
      continue
    }

    if (kind === 'HALT') {
      outwords.push(emitInstWord(0xF))
      pc += 1
      continue
    }

    // INST
    let parts = payload.trim().split(/[\s,]+/)
    let op    = parts[0].toUpperCase()
    let instr

    switch (op) {
      case 'NOP':
        instr = emitInstWord(0x0)
        break
      case 'ADD': {
        let rd = regnum(parts[1]), rs = regnum(parts[2])
        instr = emitInstWord(0x1, rd, rs)
        break
      }
      case 'SUB': {
        let rd = regnum(parts[1]), rs = regnum(parts[2])
        instr = emitInstWord(0x2, rd, rs)
        break
      }
      case 'LI': {
        let rd  = regnum(parts[1])
        let imm = parseImm(parts[2]) & 0xFFFFn
        instr = emitInstWord(0x3, rd, 0, imm)
        break
      }
      case 'LD': {
        let rd   = regnum(parts[1])
        let addr = parseImm(parts[2]) & 0xFFn
        instr = emitInstWord(0x4, rd, 0, addr)
        break
      }
      case 'ST': {
        let rd   = regnum(parts[1])
        let addr = parseImm(parts[2]) & 0xFFn
        instr = emitInstWord(0x5, rd, 0, addr)
        break
      }
      case 'JZ': {
        let rd       = regnum(parts[1])
        let dispStr  = parts[2]
        let disp     = labels.hasOwnProperty(dispStr)
                     ? BigInt(labels[dispStr] & 0xFF)
                     : parseImm(dispStr) & 0xFFn
        instr = emitInstWord(0x6, rd, 0, disp)
        break
      }
      case 'JMP': {
        let target = parts[1]
        let addr   = labels.hasOwnProperty(target)
                   ? BigInt(labels[target] & 0xFF)
                   : parseImm(target) & 0xFFn
        instr = emitInstWord(0x7, 0, 0, addr)
        break
      }
      case 'SHL': {
        let rd = regnum(parts[1]), rs = regnum(parts[2])
        instr = emitInstWord(0x9, rd, rs)
        break
      }
      case 'HALT':
        instr = emitInstWord(0xF)
        break
      default:
        throw new Error(`Unknown op: ${payload}`)
    }

    outwords.push(instr)
    pc += 1
  }

  return outwords
}

// Write ROM hex file
function writeRom(words, filename, padTo) {
  let lines = words.map(w =>
    w.toString(16).padStart(16, '0')
  )
  if (padTo && padTo > lines.length) {
    for (let i = lines.length; i < padTo; i++) {
      lines.push('0000000000000000')
    }
  }
  fs.writeFileSync(filename, lines.join('\n') + '\n')
  console.log(`Wrote ${words.length} words to ${filename}` +
              (padTo ? ` (padded to ${padTo})` : ''))
}

// Main
try {
  let { expanded, labels } = firstPass(readSource(srcFile))
  let outwords            = secondPass(expanded, labels)
  writeRom(outwords, outFile, pad)
} catch (err) {
  console.error('Error:', err.message)
  process.exit(1)
}
