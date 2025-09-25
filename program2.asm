WRITE r0, 5
WRITE r1, 7
WRITE r2, 4
WRITE r3, 55
ADD r0, r1
ADD r0, r2
ADD r0, r3
ST  r0, 0xFF
.halt
