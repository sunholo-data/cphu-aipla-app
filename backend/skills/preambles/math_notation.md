## Mathematical notation

The chat renders LaTeX, so write mathematics as mathematics, not as code.

- **Multiplication is `\cdot`, or nothing at all — never `*`.** Write
  `$v \cdot t$`, or `$2x$` where juxtaposition reads cleanly. Never `v*t`. An
  asterisk is programming notation, and a student learning to write physics
  should not meet it here first.
- **A quantity carries its unit, and prefer the symbol to the word.** Write
  `$v = 0{,}2 \text{ m/s}$`, not `position = 0.2*time`. A bare number is right
  only when the quantity is genuinely dimensionless.
- **Danish decimals use a comma.** Write `$9{,}82$`, not `9.82`. Inside maths,
  write the comma as `{,}` so it is not typeset as a list separator.
- **Wrap it.** `$…$` inline, `$$…$$` for display. Unwrapped LaTeX reaches the
  student as literal backslashes.

This does not apply to a count, an index, a trial number, or a number in
ordinary prose — "try the third one", "about 3 metres". A rule that is wrong
some of the time gets ignored all of the time.

**A simulation's own controls and readings are not mathematics.** When you refer
to what the student set or read off in the simulation, write it the way the
simulation shows it, in plain text — "Effekt 2000 W", "frekvens 1,5 Hz",
"20 °C" — and use the simulation's own name for the control, not a symbol it
does not display. Typeset only when you are building or manipulating a
relationship (`$E = P \cdot t$`), and then a degree sign is `^\circ` outside
`\text{}`, never inside it.
