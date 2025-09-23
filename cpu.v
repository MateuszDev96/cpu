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

    // ROM instrukcji 64-bit, 256 słów
    wire [63:0] instr;
    rom64 #(.WIDTH(64), .DEPTH(256), .INIT_FILE("main.hex")) imem (
        .clk(clk),
        .addr(pc[7:0]),
        .q(instr)
    );

    // Rejestry 8 x 64-bit
    reg [63:0] rf [0:7];
    wire [2:0] rd = instr[59:57];
    wire [2:0] rs = instr[56:54];

    // Dmem 256 x 64-bit
    reg [63:0] dmem [0:255];

    wire [3:0]  op     = instr[63:60];
    wire [15:0] imm16  = instr[15:0];
    wire [7:0]  addr8  = instr[7:0];

    reg [63:0] alu;

    // Cykliczny licznik zegarów
    reg [2:0] cycle_count;

    integer i;
    always @(posedge clk) begin
        if (rst) begin
            pc <= 64'h0;
            cycle_count <= 0;
            for (i = 0; i < 8; i = i + 1) rf[i] <= 64'h0;
            for (i = 0; i < 256; i = i + 1) dmem[i] <= 64'h0;
            io_write <= 1'b0;
            io_data  <= 64'h0;
        end else begin
            // reset sygnałów IO
            io_write <= 1'b0;
            io_data  <= 64'h0;

            // Odliczanie cykli między instrukcjami
            if (cycle_count == INSTR_PERIOD - 1) begin
                cycle_count <= 0;

                // Wykonanie instrukcji
                pc <= pc + 1;
                case (op)
                    4'h0: begin end // NOP
                    4'h1: begin // ADD rd, rs
                        alu = rf[rd] + rf[rs];
                        rf[rd] <= alu;
                    end
                    4'h2: begin // SUB rd, rs
                        alu = rf[rd] - rf[rs];
                        rf[rd] <= alu;
                    end
                    4'h3: begin // LI rd, imm16 zero-extended
                        rf[rd] <= {48'h0, imm16};
                    end
                    4'h4: begin // LD rd, addr8
                        rf[rd] <= dmem[addr8];
                    end
                    4'h5: begin // ST rd, addr8
                        dmem[addr8] <= rf[rd];
                        if (addr8 == 8'hFF) begin
                            io_write <= 1'b1;
                            io_data  <= rf[rd];
                        end
                    end
                    4'h6: begin // JZ rd, disp8 (signed offset)
                        if (rf[rd] == 64'h0) begin
                            pc <= pc + {{56{imm16[7]}}, imm16[7:0]};
                        end
                    end
                    4'h7: begin // JMP imm16 (absolute jump)
                        pc <= {56'h0, imm16[7:0]};
                    end
                    default: begin end
                endcase
            end else begin
                cycle_count <= cycle_count + 1;
            end
        end
    end
endmodule

// Prosta pamięć ROM 64-bit
module rom64 #(parameter WIDTH=64, DEPTH=256, INIT_FILE="") (
    input wire clk,
    input wire [7:0] addr,
    output reg [WIDTH-1:0] q
);
    reg [WIDTH-1:0] mem [0:DEPTH-1];

    initial begin
        if (INIT_FILE != "") $readmemh(INIT_FILE, mem);
    end

    always @(posedge clk)
        q <= mem[addr];
endmodule
