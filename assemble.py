#!/usr/bin/env python3
"""
assemble64.py - dwuprzebiegowy assembler dla 64-bitowego micro-RISC
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
        return int(s, 16)
    if s.endswith("b"):
        return int(s[:-1], 2)
    return int(s, 10)

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
    labels = {}
    expanded = []
    pc = 0
    for orig, code in lines:
        s = code.strip()
        if not s:
            continue
        # Etykieta - dopuszczamy też etykiety zaczynające się od kropki, np ".loop:"
        if re.match(r'^\.?[A-Za-z_]\w*:$', s):
            lab = s[:-1]
            if lab in labels:
                raise ValueError(f"Duplicate label {lab}")
            labels[lab] = pc
            # print(f"Label found: {lab} at PC={pc}")  # debug
            continue  # nie dodajemy etykiety jako instrukcji
        # Dyrektywy string i asciz
        m = re.match(r'^\.(string|asciz)\s+"(.*)"\s*$', s)
        if m:
            kind = m.group(1)
            raw = m.group(2)
            txt = unescape_string(raw)
            for ch in txt:
                expanded.append(("BYTE", ch))
                pc += 2
            if kind == "asciz":
                expanded.append(("BYTE", "\x00"))
                pc += 2
            continue
        # Dyrektywa halt
        if s.lower() == ".halt":
            expanded.append(("HALT", None))
            pc += 1
            continue
        # Inne instrukcje
        expanded.append(("INST", s))
        # print(f"Instruction added: {s} at PC={pc}")  # debug
        pc += 1
    return expanded, labels

def emit_inst_word(opcode, rd=0, rs=0, imm16=0):
    """
    Kodowanie 64-bitowego słowa instrukcji:
    [63:60] opcode
    [59:57] rd
    [56:54] rs
    [53:48] zarezerwowane (0)
    [47:0]  imm16 (zero-rozszerzone)
    """
    word = ((opcode & 0xF) << 60) | ((rd & 0x7) << 57) | ((rs & 0x7) << 54) | (imm16 & 0xFFFF)
    return word & 0xFFFFFFFFFFFFFFFF

def second_pass(expanded, labels):
    outwords = []
    pc = 0
    for kind, payload in expanded:
        # print(f"Second pass line kind={kind} payload={payload} at PC={pc}")  # debug
        if kind == "BYTE":
            val = ord(payload)
            # Ładuj znak do r0 i wypisz przez IO (adres 0xFF)
            outwords.append(emit_inst_word(0x3, rd=0, imm16=val))       # LI r0, val
            outwords.append(emit_inst_word(0x5, rd=0, imm16=0x00FF))    # ST r0, 0xFF (IO)
            pc += 2
            continue
        if kind == "HALT":
            # Tu możesz dostosować, ale na razie robimy JMP do siebie (lub HALT)
            outwords.append(emit_inst_word(0xF))
            pc += 1
            continue
        # kind == INST
        s = payload.strip()
        parts = re.split(r'[,\s]+', s)
        op = parts[0].upper()
        if op == "NOP":
            instr_word = emit_inst_word(0x0)
        elif op == "ADD":
            rd = regnum(parts[1])
            rs = regnum(parts[2])
            instr_word = emit_inst_word(0x1, rd, rs)
        elif op == "SUB":
            rd = regnum(parts[1])
            rs = regnum(parts[2])
            instr_word = emit_inst_word(0x2, rd, rs)
        elif op == "LI":
            rd = regnum(parts[1])
            imm = parse_imm(parts[2]) & 0xFFFF
            instr_word = emit_inst_word(0x3, rd, 0, imm)
        elif op == "LD":
            rd = regnum(parts[1])
            addr = parse_imm(parts[2]) & 0xFF
            instr_word = emit_inst_word(0x4, rd, 0, addr)
        elif op == "ST":
            rd = regnum(parts[1])
            addr = parse_imm(parts[2]) & 0xFF
            instr_word = emit_inst_word(0x5, rd, 0, addr)
        elif op == "JZ":
            rd = regnum(parts[1])
            disp_str = parts[2]
            if disp_str in labels:
                disp = labels[disp_str] & 0xFF
            else:
                disp = parse_imm(disp_str) & 0xFF
            instr_word = emit_inst_word(0x6, rd, 0, disp)
        elif op == "JMP":
            target = parts[1]
            if target in labels:
                addr = labels[target] & 0xFF
            else:
                addr = parse_imm(target) & 0xFF
            instr_word = emit_inst_word(0x7, 0, 0, addr)
        elif op == "SHL":
            rd = regnum(parts[1])
            rs = regnum(parts[2])
            instr_word = emit_inst_word(0x9, rd, rs)
        elif op == "HALT":
            instr_word = emit_inst_word(0xF)
        else:
            raise ValueError(f"Unknown op/line: {s}")
        outwords.append(instr_word)
        pc += 1
    return outwords

def write_rom(outwords, outname, pad=None):
    with open(outname, "w") as f:
        for w in outwords:
            f.write(f"{w:016x}\n")  # 64-bit hex słowo
        if pad:
            missing = pad - len(outwords)
            if missing > 0:
                for _ in range(missing):
                    f.write("0000000000000000\n")
    print(f"Wrote {len(outwords)} words to {outname}" + (f" (padded to {pad})" if pad else ""))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", help="plik z kodem asemblera")
    ap.add_argument("--out", default="main.hex", help="plik wyjściowy ROM")
    ap.add_argument("--pad", type=int, default=0, help="wyśrodkuj do podanej liczby słów")
    args = ap.parse_args()

    lines = read_source(args.source)
    expanded, labels = first_pass(lines)
    outwords = second_pass(expanded, labels)
    pad = args.pad if args.pad and args.pad > 0 else None
    write_rom(outwords, args.out, pad=pad)

if __name__ == "__main__":
    main()
