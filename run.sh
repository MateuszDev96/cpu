./compile.sh
iverilog -o sim.vvp cpu.v tb.v
vvp sim.vvp
