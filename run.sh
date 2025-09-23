python3 assemble64.py program.asm --out main.hex --pad 256
iverilog -o sim.vvp cpu64.v tb.v
vvp sim.vvp
