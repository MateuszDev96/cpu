SETI r0, 15
SETI r1, 1
ADDI r0, r0, 10

.loop:
SEND r0, 0xFF
SUB r0, r0, r1
JUMPIF0 r0, .halt
JUMP .loop

.halt:
HALT
