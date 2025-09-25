node compile.js program.asm --out main.hex --pad 256
iverilog -o sim.vvp cpu.v tb.v
vvp sim.vvp
