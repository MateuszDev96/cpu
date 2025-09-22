#!/usr/bin/env python3
"""
assemble.py - dwuprzebiegowy assembler dla 32-bitowego micro-RISC

Instrukcje (skrót):
  NOP
  ADD rd, rs
  SUB rd, rs
  LI  rd, imm16
  LD  rd, addr8
  ST  rd, addr8
  JZ  rd, disp8   (disp8 w imm16[7:0], sign-extended)
  JMP addr_or_label  (adres w imm16[7:0])

Dyrektywy:
  .string "..."    - rozpisuje na LI r0,chr ; ST r0,0xFF
  .asciz "..."     - jak .string + dodaje 0 byte
  .halt            - JMP do własnego adresu (halt)
  ; lub # komentarz

Opcje:
  --out FILE  (domyślnie rom_init.hex)
  --pad N     (dopaduj plik do N słów, opcjonalnie)
"""
import sys, re, argparse

def regnum(r):
    m = re.match(r'^[rR]?([0-7])$', r)
    if not m:
        raise ValueError(f"Bad register: {r}")
    return int(m.group(1))

def parse_imm(s):
    s = s.strip()
    if s.startswith("0x") or s.startswith("0X"):
        return int(s,16)
    if s.endswith("b"):
        return int(s[:-1],2)
    return int(s,10)

def unescape_string(s):
    return bytes(s, "utf8").decode("unicode_escape")

def read_source(fname):
    raw = []
    with open(fname, encoding="utf8") as f:
        for ln in f:
            orig = ln.rstrip("\n")
            code = re.split(r'[;#]', ln, 1)[0]
            raw.append((orig, code))
    return raw

def first_pass(lines):
    """
    Rozwijamy etykiety i dyrektywy tak, aby wiedzieć ile słów zajmie każdy wpis.
    Zwracamy listę (kind, payload) i mapę label->addr (pc).
    kind: INST (payload=instr text), BYTE (payload=single char), HALT (None)
    """
    labels = {}
    expanded = []
    pc = 0
    for orig, code in lines:
        s = code.strip()
        if not s:
            continue
        # label
        if re.match(r'^[A-Za-z_]\w*:$', s):
            lab = s[:-1]
            if lab in labels:
                raise ValueError(f"Duplicate label {lab}")
            labels[lab] = pc
            continue
        # directives .string / .asciz
        m = re.match(r'^\.(string|asciz)\s+"(.*)"\s*$', s)
        if m:
            kind = m.group(1)
            raw = m.group(2)
            txt = unescape_string(raw)
            for ch in txt:
                expanded.append(("BYTE", ch))
                pc += 2   # LI + ST -> 2 słowa
            if kind == "asciz":
                expanded.append(("BYTE", "\x00"))
                pc += 2
            continue
        if s.lower() == ".halt":
            expanded.append(("HALT", None))
            pc += 1
            continue
        # normal instruction
        expanded.append(("INST", s))
        pc += 1
    return expanded, labels

def emit_inst_word(opcode, rd=0, rs=0, imm16=0):
    """
    Encode 32-bit instruction word:
    [31:28] opcode
    [27:25] rd
    [24:22] rs
    [21:16] reserved (0)
    [15:0] imm16
    """
    w = ((opcode & 0xF) << 28) | ((rd & 0x7) << 25) | ((rs & 0x7) << 22) | (imm16 & 0xFFFF)
    return w & 0xFFFFFFFF

def second_pass(expanded, labels):
    outwords = []
    pc = 0
    for kind, payload in expanded:
        if kind == "BYTE":
            val = ord(payload)
            # LI r0, imm16
            outwords.append(emit_inst_word(0x3, rd=0, rs=0, imm16=val & 0xFFFF))
            # ST r0, 0xFF (I/O)
            outwords.append(emit_inst_word(0x5, rd=0, rs=0, imm16=0x00FF))
            pc += 2
            continue
        if kind == "HALT":
            addr = pc & 0xFF
            outwords.append(emit_inst_word(0x7, rd=0, rs=0, imm16=addr & 0xFFFF))
            pc += 1
            continue
        # INST
        s = payload.strip()
        parts = re.split(r'[,\s]+', s)
        op = parts[0].upper()
        if op == "NOP":
            instr_word = emit_inst_word(0x0, 0, 0, 0)
        elif op == "ADD":
            rd = regnum(parts[1]); rs = regnum(parts[2])
            instr_word = emit_inst_word(0x1, rd, rs, 0)
        elif op == "SUB":
            rd = regnum(parts[1]); rs = regnum(parts[2])
            instr_word = emit_inst_word(0x2, rd, rs, 0)
        elif op == "LI":
            rd = regnum(parts[1]); imm = parse_imm(parts[2]) & 0xFFFF
            instr_word = emit_inst_word(0x3, rd, 0, imm)
        elif op == "LD":
            rd = regnum(parts[1]); addr = parse_imm(parts[2]) & 0xFF
            instr_word = emit_inst_word(0x4, rd, 0, addr & 0xFFFF)
        elif op == "ST":
            rd = regnum(parts[1]); addr = parse_imm(parts[2]) & 0xFF
            instr_word = emit_inst_word(0x5, rd, 0, addr & 0xFFFF)
        elif op == "JZ":
            rd = regnum(parts[1]); disp = parse_imm(parts[2]) & 0xFF
            instr_word = emit_inst_word(0x6, rd, 0, disp & 0xFFFF)
        elif op == "JMP":
            target = parts[1]
            if target in labels:
                addr = labels[target] & 0xFF
            else:
                addr = parse_imm(target) & 0xFF
            instr_word = emit_inst_word(0x7, 0, 0, addr & 0xFFFF)
        else:
            raise ValueError(f"Unknown op/line: {s}")
        outwords.append(instr_word)
        pc += 1
    return outwords

def write_rom(outwords, outname, pad=None):
    with open(outname, "w") as f:
        for w in outwords:
            f.write(f"{w:08x}\n")
        if pad:
            missing = pad - len(outwords)
            if missing > 0:
                for _ in range(missing):
                    f.write("00000000\n")
    print(f"Wrote {len(outwords)} words to {outname}" + (f" (padded to {pad})" if pad else ""))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", help="assembly source file")
    ap.add_argument("--out", default="rom_init.hex", help="output rom file")
    ap.add_argument("--pad", type=int, default=0, help="pad output to this number of words (optional)")
    args = ap.parse_args()

    lines = read_source(args.source)
    expanded, labels = first_pass(lines)
    outwords = second_pass(expanded, labels)
    pad = args.pad if args.pad and args.pad > 0 else None
    write_rom(outwords, args.out, pad=pad)

if __name__ == "__main__":
    main()
