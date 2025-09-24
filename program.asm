LI r1, 1         ; ustaw r1 = 1
LI r0, 5         ; r0 = licznik
.loop:
ST  r0, 0xFF     ; wypisz r0
SUB r0, r1       ; zmniejsz r0 o 1
JZ  r0, 2        ; jeśli r0 == 0, przeskocz 2 instrukcje (czyli HALT)
JMP .loop
HALT             ; tu zakończ program
