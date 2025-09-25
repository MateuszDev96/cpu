#!/usr/bin/env node
/**
 * assemble64.js – dwuprzebiegowy assembler dla 64-bitowego micro-RISC
 */

const fs   = require('fs')
const path = require('path')

// parse command-line arguments
const argv = process.argv.slice(2)
if (argv.length < 1) {
  console.error(`Usage: ${path.basename(process.argv[1])} <source.s> [--out main.hex] [--pad N]`)
  process.exit(1)
}

let srcFile = argv[0]
let outFile = 'main.hex'
let pad     = 0

for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--out' && i + 1 < argv.length) {
    outFile = argv[++i]
  }
  else if (argv[i] === '--pad' && i + 1 < argv.length) {
    pad = parseInt(argv[++i], 10) || 0
  }
}

// utilities

// r0..r7 → 0–7
function regnum(r) {
  const m = /^([rR]?)([0-7])$/.exec(r)
  if (!m) throw new Error(`Bad register: ${r}`)
  return Number(m[2])
}

// immediate: decimal | hex 0x… | binary …b
function parseImm(s) {
  s = s.trim()
  if (/^0x/i.test(s))      return BigInt(s)
  if (/^[01]+b$/i.test(s)) return BigInt('0b' + s.slice(0, -1))
  return BigInt(s)
}

// unescape "\n", "\u1234" via JSON
function unescapeString(str) {
  return JSON.parse(`"${str.replace(/"/g, '\\"')}"`)
}

// read source, strip comments after '#' or ';'
function readSource(fname) {
  return fs.readFileSync(fname, 'utf8')
    .split(/\r?\n/)
    .map(ln => {
      const orig = ln.replace(/\r?\n$/, '')
      const code = ln.split(/[#;]/, 1)[0]
      return [orig, code]
    })
}

// first pass: labels + expand .string/.asciz/.halt
function firstPass(lines) {
  const labels   = {}
  const expanded = []
  let   pc       = 0

  for (const [orig, code] of lines) {
    const s = code.trim()
    if (!s) continue

    // label definition
    if (/^\.?[A-Za-z_]\w*:$/.test(s)) {
      const lab = s.slice(0, -1)
      if (labels.hasOwnProperty(lab)) {
        throw new Error(`Duplicate label ${lab}`)
      }
      labels[lab] = pc
      continue
    }

    // .string / .asciz directives
    const m = /^\.(string|asciz)\s+"(.*)"\s*$/.exec(s)
    if (m) {
      const kind = m[1]
      const raw  = m[2]
      const txt  = unescapeString(raw)
      for (const ch of txt) {
        expanded.push(['BYTE', ch])
        pc += 2
      }
      if (kind === 'asciz') {
        expanded.push(['BYTE', '\x00'])
        pc += 2
      }
      continue
    }

    // .halt directive
    if (s.toLowerCase() === '.halt') {
      expanded.push(['HALT', null])
      pc += 1
      continue
    }

    // ordinary instruction
    expanded.push(['INST', s])
    pc += 1
  }

  return { expanded, labels }
}

// emit 64-bit instruction word
const MASK64 = (1n << 64n) - 1n
function emitInstWord(opcode, rd = 0, rs = 0, imm16 = 0n) {
  const w =
      (BigInt(opcode & 0xF) << 60n) |
      (BigInt(rd      & 0x7) << 57n) |
      (BigInt(rs      & 0x7) << 54n) |
      (imm16 & 0xFFFFn)
  return w & MASK64
}

// second pass: assemble
function secondPass(expanded, labels) {
  const outwords = []
  let   pc       = 0

  for (const [kind, payload] of expanded) {
    // BYTE → LI r0,val + ST r0,0xFF
    if (kind === 'BYTE') {
      const val = BigInt(payload.charCodeAt(0))
      outwords.push(emitInstWord(0x3, 0, 7, val & 0xFFFFn)) // LI r0,val
      outwords.push(emitInstWord(0x5, 0, 7, 0xFFn))         // ST r0,0xFF
      pc += 2
      continue
    }

    // HALT
    if (kind === 'HALT') {
      outwords.push(emitInstWord(0xF))
      pc += 1
      continue
    }

    // INST
    const parts = payload.trim().split(/[\s,]+/)
    const op    = parts[0].toUpperCase()
    let   instr = null

    // helper: two-operand R/I-type
    function twoOp(opcode) {
      const rd  = regnum(parts[1])
      const op2 = parts[2]
      if (/^[rR]?[0-7]$/.test(op2)) {
        const rs = regnum(op2)
        return emitInstWord(opcode, rd, rs, 0n)
      } else {
        const imm = parseImm(op2) & 0xFFFFn
        return emitInstWord(opcode, rd, 7, imm)
      }
    }

    switch (op) {
      case 'NOP':
        instr = emitInstWord(0x0)
        break

      case 'ADD':
        instr = twoOp(0x1)
        break

      case 'SUB':
        instr = twoOp(0x2)
        break

      case 'SUBI': {
        const rd  = regnum(parts[1])
        const imm = parseImm(parts[2]) & 0xFFFFn
        instr = emitInstWord(0xD, rd, 7, imm)
      }
      break

      case 'ADD':
        instr = twoOp(0x1)
        break

      case 'ADDI': {
        const rd  = regnum(parts[1])
        const imm = parseImm(parts[2]) & 0xFFFFn
        instr = emitInstWord(0xC, rd, 7, imm)
      }
      break

      case 'OR':
        instr = twoOp(0xD)
        break

      case 'XOR':
        instr = twoOp(0xE)
        break

      case 'SHL':
        instr = twoOp(0x9)
        break

      case 'SHR':
        instr = twoOp(0xA)
        break

      case 'SAR':
        instr = twoOp(0xB)
        break

      case 'LI':
        {
          const rd  = regnum(parts[1])
          const imm = parseImm(parts[2]) & 0xFFFFn
          instr = emitInstWord(0x3, rd, 7, imm)
        }
        break

      case 'LD':
        {
          const rd   = regnum(parts[1])
          const addr = parseImm(parts[2]) & 0xFFn
          instr = emitInstWord(0x4, rd, 0, addr)
        }
        break

      case 'ST':
        {
          const rd   = regnum(parts[1])
          const addr = parseImm(parts[2]) & 0xFFn
          instr = emitInstWord(0x5, rd, 0, addr)
        }
        break

      case 'JZ':
        {
          const rd      = regnum(parts[1])
          const tgt     = parts[2]
          const disp    = labels.hasOwnProperty(tgt)
                        ? BigInt(labels[tgt] & 0xFF)
                        : parseImm(tgt) & 0xFFn
          instr = emitInstWord(0x6, rd, 0, disp)
        }
        break

      case 'JMP':
        {
          const tgt  = parts[1]
          const addr = labels.hasOwnProperty(tgt)
                     ? BigInt(labels[tgt] & 0xFF)
                     : parseImm(tgt) & 0xFFn
          instr = emitInstWord(0x7, 0, 0, addr)
        }
        break

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

// write ROM hex file
function writeRom(words, filename, padTo) {
  const lines = words.map(w =>
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

// main
try {
  const lines        = readSource(srcFile)
  const { expanded, labels } = firstPass(lines)
  const outwords     = secondPass(expanded, labels)
  writeRom(outwords, outFile, pad)
} catch (err) {
  console.error('Error:', err.message)
  process.exit(1)
}
