SETI r0, 15
SETI r1, 1
SUBI r0, r0, 1
SUBI r0, r0, 1
SUBI r0, r0, 1
ADDI r0, r0, 12

.loop:
SEND  r0, 0xFF
SUB  r0, r0, r1
JUMP_IF0   r0, .halt
JUMP .loop

.halt:
HALT
