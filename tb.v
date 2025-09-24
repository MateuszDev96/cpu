`timescale 1ns/1ps
module tb;
    reg clk = 0;
    reg rst = 1;
    wire [63:0] pc;
    wire io_write;
    wire [63:0] io_data;

    cpu uut (
        .clk(clk),
        .rst(rst),
        .dbg_pc(pc),
        .io_write(io_write),
        .io_data(io_data)
    );

    always #5 clk = ~clk; // zegar 100MHz

    initial begin
        #12 rst = 0;
        #3000000 $finish;  // symulacja potrwa 3 sekundy
    end

    reg prev = 0;
    always @(posedge clk) begin
        if (!prev && io_write) begin
            $display("%0d", io_data); // wypisuje 64-bitową wartość jako dziesiętną
        end
        prev <= io_write;
    end
endmodule
