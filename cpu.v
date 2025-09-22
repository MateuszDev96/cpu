// cpu.v - minimalny jednocyklowy micro-risc (32-bit data, 32-bit instr)
`default_nettype none
module cpu (
    input  wire clk,
    input  wire rst,
    output wire [7:0] dbg_pc,       // nadal pokazujemy niskie bity PC dla debug
    output reg  io_write,
    output reg  [31:0] io_data
);
    // PC nadal indeksuje słowa ROM; dostosuj szerokość do DEPTH ROM
    reg [7:0] pc;
    wire [31:0] instr;
    assign dbg_pc = pc;

    // ROM instrukcji 32-bitowe słowa
    rom32 #(.WIDTH(32), .DEPTH(256), .INIT_FILE("rom_init.hex")) imem (
        .clk(clk),
        .addr(pc),
        .q(instr)
    );

    // Rejestry 8 x 32-bit
    reg [31:0] rf [0:7];
    wire [2:0] rd = instr[27:25];
    wire [2:0] rs = instr[24:22];

    // Dmem 256 x 32-bit (adres 0..255)
    reg [31:0] dmem [0:255];

    // pola instrukcji
    wire [3:0] op = instr[31:28];
    wire [15:0] imm16 = instr[15:0];
    wire [7:0] addr8 = instr[7:0];

    reg [31:0] alu;

    integer i;
    always @(posedge clk) begin
        if (rst) begin
            pc <= 8'h00;
            for (i=0;i<8;i=i+1) rf[i] <= 32'h00000000;
            for (i=0;i<256;i=i+1) dmem[i] <= 32'h00000000;
            io_write <= 1'b0; io_data <= 32'h00000000;
        end else begin
            io_write <= 1'b0;
            io_data  <= 32'h00000000;
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
                4'h3: begin // LI rd, imm16 (zero-extended)
                    rf[rd] <= {16'h0000, imm16};
                end
                4'h4: begin // LD rd, addr8 (zero-extended addr)
                    rf[rd] <= dmem[addr8];
                end
                4'h5: begin // ST rd, addr8
                    dmem[addr8] <= rf[rd];
                    if (addr8==8'hFF) begin
                        // jeśli chcesz mapować IO do 0xFF, ustaw adres IO tutaj
                        io_write <= 1'b1;
                        io_data  <= rf[rd];
                    end
                end
                4'h6: begin // JZ rd, disp8 (signed 8-bit displacement in imm16[7:0])
                    // jeśli rf[rd] == 0, pc += signext(disp8)
                    if (rf[rd]==32'h00000000) begin
                        pc <= pc + {{24{imm16[7]}}, imm16[7:0]};
                    end
                end
                4'h7: begin // JMP addr16 (direct)
                    pc <= imm16[7:0]; // ograniczone do 8-bit PC width; dostosuj jeśli PC szersze
                end
                default: begin end
            endcase
        end
    end
endmodule

module rom32 #(parameter WIDTH=32, DEPTH=256, INIT_FILE="") (
    input wire clk,
    input wire [7:0] addr,
    output reg [WIDTH-1:0] q
);
    reg [WIDTH-1:0] mem [0:DEPTH-1];
    initial begin
        if (INIT_FILE!="") $readmemh(INIT_FILE, mem);
        // $display("ROM init mem[0]=%08h mem[1]=%08h", mem[0], mem[1]);
    end
    always @(posedge clk) q <= mem[addr];
endmodule
