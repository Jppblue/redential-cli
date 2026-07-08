# Security policy

## Reporting a vulnerability

Email **security@redential.com** (or juan@redential.com). Do not open a
public issue for anything that could affect users before a fix ships.

You can expect an acknowledgment within 48 hours. We will coordinate
disclosure timing with you.

## Scope

Especially interested in:

- Any way the bundle could leak source code, paths, secrets, or other
  contributors' identities (violations of docs/principles.md)
- Token handling issues (device flow, credential storage, permissions)
- Supply-chain concerns in dependencies or the release pipeline

## Verifying releases

All npm releases are published from GitHub Actions with `--provenance`.
You can verify any version was built from this repository:

```bash
npm audit signatures
```
