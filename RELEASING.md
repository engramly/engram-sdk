# Manual npm release

This repository publishes three npm packages together:

- `@engramly/engram` — TypeScript SDK
- `engramly` — CLI (`engram`)
- `@engramly/mcp-server` — MCP server

The procedure below is intentionally manual. It does not require GitHub Actions,
release tags, or CI-based publishing. Run it from the repository root.
Regular pull-request CI may still run tests, but it never publishes packages.
Only a maintainer with npm access performs the publishing commands in this guide.

## Prerequisites

Confirm the npm account, repository state, and current registry versions:

```bash
npm whoami
git status --short
git pull --ff-only

npm view @engramly/engram version
npm view engramly version
npm view @engramly/mcp-server version
```

The worktree must be clean before changing versions. The npm user must have
write access to all three packages.

## 1. Choose one version

All three packages use the same version. Replace `0.1.1` below with the intended
release version. Never reuse a version already present on npm; published npm
versions cannot be overwritten.

```bash
export ENGRAMLY_RELEASE_VERSION=0.1.1
```

## 2. Update package versions

Do not let `npm version` create a commit or Git tag:

```bash
npm version "$ENGRAMLY_RELEASE_VERSION" --workspace typescript --no-git-tag-version
npm version "$ENGRAMLY_RELEASE_VERSION" --workspace packages/cli --no-git-tag-version
npm version "$ENGRAMLY_RELEASE_VERSION" --workspace packages/mcp-server --no-git-tag-version
bun install
```

Verify that all package versions match:

```bash
node -e '
for (const path of [
  "typescript/package.json",
  "packages/cli/package.json",
  "packages/mcp-server/package.json",
]) console.log(path, require("./" + path).version)
'
```

## 3. Run local release checks

```bash
bun install --frozen-lockfile
bun run build
bun test

cd python
uv run --with ruff ruff check .
uv run --with pytest --with pytest-asyncio --with respx \
  --with 'pydantic>=2' --with 'httpx>=0.27' pytest -q
cd ..

npm pack --dry-run --workspace typescript
npm pack --dry-run --workspace packages/cli
npm pack --dry-run --workspace packages/mcp-server
git diff --check
```

Check that every tarball contains its expected `dist/`, `README.md`, `LICENSE`,
and `package.json`. Stop if any command fails.

## 4. Commit and push the version change

Review the exact files first:

```bash
git status --short
git diff -- typescript/package.json packages/cli/package.json \
  packages/mcp-server/package.json bun.lock
```

Then commit and push:

```bash
git add typescript/package.json packages/cli/package.json \
  packages/mcp-server/package.json bun.lock
git commit -m "chore: release $ENGRAMLY_RELEASE_VERSION"
git push origin main
```

This manual process does not create or push a Git tag.

## 5. Publish manually

Publish in dependency order:

```bash
npm publish --workspace typescript --access public
npm publish --workspace packages/cli
npm publish --workspace packages/mcp-server --access public
```

Before confirming each publish, inspect npm's package summary and make sure the
package name, version, access level, and included files are correct.

Do not add `--provenance` to local publishes. npm provenance requires a
supported CI identity provider; local publishing otherwise fails with
`Automatic provenance generation not supported for provider: null`.

If one publish succeeds and a later one fails, do not retry the successful
package and do not change its version. Fix the failure and continue with only
the unpublished package(s).

## 6. Verify the registry release

```bash
npm view @engramly/engram@"$ENGRAMLY_RELEASE_VERSION" version
npm view engramly@"$ENGRAMLY_RELEASE_VERSION" version
npm view @engramly/mcp-server@"$ENGRAMLY_RELEASE_VERSION" version
```

Allow a short registry propagation delay if a package initially returns 404.

## 7. Verify clean installation

Use a temporary directory so the test cannot resolve workspace packages:

```bash
export ENGRAMLY_RELEASE_TEST_DIR="$(mktemp -d)"
npm install --prefix "$ENGRAMLY_RELEASE_TEST_DIR" \
  "@engramly/engram@$ENGRAMLY_RELEASE_VERSION" \
  "engramly@$ENGRAMLY_RELEASE_VERSION" \
  "@engramly/mcp-server@$ENGRAMLY_RELEASE_VERSION"

ENGRAMLY_CONFIG_DIR="$ENGRAMLY_RELEASE_TEST_DIR/config" \
  "$ENGRAMLY_RELEASE_TEST_DIR/node_modules/.bin/engram" auth status --json

ENGRAMLY_API_KEY=test \
  "$ENGRAMLY_RELEASE_TEST_DIR/node_modules/.bin/engramly-mcp"
```

The MCP process waits on stdio when it starts successfully; stop it with
`Ctrl-C`. Then verify the repository is clean:

```bash
git status --short
```

## Failure rules

- Never reuse or overwrite a published npm version.
- Never run `npm unpublish` as routine rollback. Publish a corrected patch
  version instead.
- Never publish with uncommitted source changes.
- Never expose npm tokens or Engramly API keys in command output or committed
  files.
- Never push a release tag during this manual workflow.
- Never add package publishing commands to the repository's CI workflows.
