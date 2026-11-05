# Releasing

Update package.json, src/appmeta/manifest.json and CHANGELOG.md together.
Run pnpm release. Inspect the versioned archive, SHA256SUMS and RELEASE_NOTES.md in dist/.

Before publishing, install the archive and check both displays, Setup, controls, persistence and clean exit.
For connected apps, verify successful refresh, invalid data, offline behavior and recovery.

The prepared GitHub workflows run checks on Windows and Linux and publish releases for numeric x.y.z tags.
Create and push a tag matching the manifest version when the source is ready for release.
