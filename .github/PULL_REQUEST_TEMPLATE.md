## Summary

<!-- What changed and why? Keep this focused. -->

## Related issue

<!-- Link the issue, if applicable. Example: Fixes https://github.com/jamesjfoong/pi-ollama/issues/1 -->

## Change type

- [ ] Bug fix
- [ ] Feature
- [ ] Documentation
- [ ] Tests
- [ ] Maintenance / dependencies
- [ ] Release

## Scope

- [ ] Runtime behavior changed
- [ ] Configuration or persisted data changed
- [ ] Backward compatibility checked
- [ ] Secrets or authentication handling changed
- [ ] README or other documentation updated
- [ ] No unrelated files changed

## Verification

<!-- Include exact commands and important results. -->

```text
npm run typecheck
npm run format:check
npm test
npm run test:coverage
```

Additional manual checks:

- [ ] Local Ollama smoke test, if applicable
- [ ] Remote or Cloud endpoint smoke test, if applicable
- [ ] `pi` or `omp` integration test, if applicable
- [ ] Error and offline behavior checked, if applicable

## Release notes

<!-- User-facing change, migration note, or "Not needed". -->

## Checklist

- [ ] Tests added or updated for behavior changes
- [ ] No secrets, tokens, or personal data added
- [ ] No breaking configuration change, or migration documented
- [ ] Documentation reflects current behavior
- [ ] CI passes
- [ ] npm publish is not included unless maintainer explicitly approved release work
