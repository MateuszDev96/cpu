`default_nettype none
module cpu (
    input  wire clk,
    input  wire rst,
    output wire [63:0] dbg_pc,
    output reg  io_write,
    output reg  [63:0] io_data
);
    parameter INSTR_PERIOD = 4;

    reg [63:0] pc;
    assign dbg_pc = pc;

    // ROM instrukcji
    wire [63:0] instruction;
    rom64 #(.WIDTH(64), .DEPTH(256), .INIT_FILE("main.hex")) imem (
        .clk(clk),
        .addr(pc[7:0]),
        .q(instruction)
    );

    // Rejestry
    reg [63:0] rf [0:7];
    wire [2:0] rd = instruction[59:57];
    wire [2:0] rs = instruction[56:54];

    // RAM
    reg [63:0] ram [0:255];

    // Dekodowanie
    wire [3:0]  op     = instruction[63:60];
    wire [15:0] imm16  = instruction[15:0];
    wire [63:0] imm64  = instruction[63:0];
    wire [7:0]  ram_addr  = instruction[7:0];

    reg [2:0] cycle_count;
    reg halted;

    integer i;
    always @(posedge clk) begin
        if (rst) begin
            pc <= 64'h0;
            cycle_count <= 0;
            halted <= 0;
            for (i = 0; i < 8; i = i + 1) rf[i] <= 64'h0;
            for (i = 0; i < 256; i = i + 1) ram[i] <= 64'h0;
            io_write <= 0;
            io_data  <= 0;
        end else if (!halted) begin
            io_write <= 0;
            io_data  <= 0;

            if (cycle_count == INSTR_PERIOD - 1) begin
                cycle_count <= 0;
                pc <= pc + 1;

                case (op)
                    4'h0: begin end // NOP
                    4'h1: rf[rd] <= rf[rd] + rf[rs];                      // ADD
                    4'h2: rf[rd] <= rf[rd] - rf[rs];                      // SUB
                    4'h3: rf[rd] <= {48'h0, imm16};                       // WRITE
                    4'h4: rf[rd] <= ram[ram_addr];                          // LD
                    4'h5: begin                                          // LOG
                        ram[ram_addr] <= rf[rd];
                        if (ram_addr == 8'hFF) begin
                            io_write <= 1;
                            io_data  <= rf[rd];
                        end
                    end
                    4'h6: if (rf[rd] == 0) pc <= pc + {{56{imm16[7]}}, imm16[7:0]}; // JZ
                    4'h7: pc <= {56'h0, imm16[7:0]};                   // JUMP
                    4'h8: rf[rd] <= imm64;                              // LI64
                    4'h9: rf[rd] <= rf[rd] << rf[rs];                  // SHL
                    4'hA: rf[rd] <= rf[rd] >> rf[rs];                  // SHR
                    4'hB: rf[rd] <= $signed(rf[rd]) >>> rf[rs];        // SAR
                    4'hC: rf[rd] <= rf[rd] + {48'h0, imm16};           // ADDI
                    4'hD: rf[rd] <= rf[rd] - {48'h0, imm16};           // SUBI
                    4'hF: halted <= 1;                                  // HALT
                    default: begin end
                endcase
            end else begin
                cycle_count <= cycle_count + 1;
            end
        end
    end
endmodule

// ROM 64-bit
module rom64 #(parameter WIDTH=64, DEPTH=256, INIT_FILE="") (
    input wire clk,
    input wire [7:0] addr,
    output reg [WIDTH-1:0] q
);
    reg [WIDTH-1:0] mem [0:DEPTH-1];
    initial if (INIT_FILE != "") $readmemh(INIT_FILE, mem);
    always @(posedge clk) q <= mem[addr];
endmodule
