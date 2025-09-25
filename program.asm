WRITE r0, 15         ; r0 = licznik
WRITE r1, 1          ; ustaw r1 = 1
SUBI r0, 1
SUBI r0, 1
SUBI r0, 1
.loop:
LOG  r0, 0xFF     ; wypisz r0
SUB r0, r1       ; zmniejsz r0 o 1
JZ  r0, 2        ; jeśli r0 == 0, przeskocz 2 instrukcje (czyli do HALT)
JUMP .loop        ; skocz na początek pętli
HALT             ; zatrzymaj program
