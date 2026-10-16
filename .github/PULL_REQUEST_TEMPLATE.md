## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## How it was checked

<!-- Commands you ran (unit tests, actual-map / hero / tour checks, decoder cross-checks) and their results. -->

## Checklist

- [ ] No game files, extracted assets, exported EBX, archive dumps, original shader bytecode or mechanical translations of it are included (`node tools/ci/check-no-game-data.mjs` passes).
- [ ] New recovered values state their source (asset, GUID, field path) or are labelled as inferred / browser choices.
- [ ] `npm run check:syntax` and `npm run test:ci` pass in `web/`; asset-dependent tests were run locally where relevant.
- [ ] Docs for the touched stage are updated.
