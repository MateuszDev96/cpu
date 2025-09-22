python3 assemble.py program.asm --out rom_init.hex --pad 256
iverilog -o sim.vvp cpu.v tb.v
vvp sim.vvp
