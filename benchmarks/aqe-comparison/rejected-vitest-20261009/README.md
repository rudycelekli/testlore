# Actual supported-framework upstream generation rejection

[Run 37949752050](https://github.com/rudycelekli/testlore/actions/runs/37949752050) at `dc4dc9d39e6661f65e58b5079659361cf560eff4` installed AQE 3.14.8 and executed the frozen Vitest profile twice. AQE rejected both artifacts for lacking executable assertions and an import of the source under test. Neither call returned a candidate, so TestLore composition validation and candidate stability were not exercised. This is a generation rejection, not a measured combination advantage or evidence that AQE's other generation modes fail.

The unchanged maintainer oracle passed both assertions twice on fixed source and failed both twice on the historical parent in each repetition. These are repeated observations of one historical bug. Generation took 1,267/589 ms; campaign execution took 4.804 s; complete installation-to-result took 27.519 s. No timeout occurred. Provider currency and token counts remain unknown (`null`); no credentials were passed.

The original ZIP is bound to GitHub artifact 11624838649 by SHA-256 `4fa0e098469cb6969a0ebbc2f4618e76ad9c48f61115567f6090e6ab658cfec1`. Selected raw JSON files are exact archived bytes; `integrity.json` records every ZIP member. Existing Node-profile failure remains separate and unchanged. Recheck the independent verdict with `node scripts/aqe-frozen-replay.js --vitest`.
