export const examples = [
  { id: 'bloom', title: 'Orbital bloom', caption: 'Turtle geometry', icon: 'flower', description: 'Small instructions. Unexpected possibilities.', source: `; A little repetition goes a long way.
; Try changing 18 to 24, or the petal size.

TO PETAL :SIZE
  REPEAT 2 [
    REPEAT 60 [FD :SIZE RT 1]
    RT 120
  ]
END

CS HT TELL []
SC 3
REPEAT 18 [PETAL 1.1 RT 20]

; A golden center
PU HOME FD 7.5 RT 90 PD
SC 11
REPEAT 180 [FD 0.26 RT 2]
HT` },
  { id: 'kinetic', title: 'Kinetic playground', caption: 'Autonomous sprites', icon: 'orbit', description: 'Give your sprites a shape, a heading, and a little momentum.', source: `; Each sprite has a mind of its own.
CS PU HT
TELL [0 1 2 3 4 5]
EACH [
  CARRY 1 + REMAINDER :YOURNUMBER 5
  SC :YOURNUMBER + 3
  SXY (:YOURNUMBER * 36 - 90) 0
  SH (:YOURNUMBER * 60)
  SS 18
]

; FREEZE pauses. THAW resumes.
; Try TELL 2 SS 1 in the console.` },
  { id: 'tree', title: 'Recursive tree', caption: 'Creative recursion', icon: 'leaf', description: 'A branching idea, made with a procedure that calls itself.', source: `; Nature has a fondness for recursion.
TO BRANCH :SIZE :DEPTH
  IF :DEPTH = 0 [STOP]
  FD :SIZE
  RT 28
  BRANCH (:SIZE * 0.72) (:DEPTH - 1)
  LT 56
  BRANCH (:SIZE * 0.72) (:DEPTH - 1)
  RT 28
  BK :SIZE
END

CS HT SC 3 TELL []
PU SXY 0 -74 PD
BRANCH 42 7
HT` },
];
