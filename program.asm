SETI r0, 15
ADDI r0, r0, 100

.loop:
SEND r0, 0xFF
SUBI r0, r0, 1
JUMPIF0 r0, .halt
JUMP .loop

.halt:
HALT
