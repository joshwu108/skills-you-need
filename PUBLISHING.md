# Publishing

## The skill

The skill is published by pushing to `main`. This repository is the marketplace, so users get the new version with:

```
/plugin marketplace update skills-you-need
```

Before pushing a change to the skill:

1. Bump `version` in `plugins/codeatlas/.claude-plugin/plugin.json`.
2. Run `npm run build` and commit the bundles under `plugins/codeatlas/skills/codeatlas/assets/`.
3. Run `claude plugin validate ./plugins/codeatlas` and `claude plugin validate ./`.

## The VS Code extension

These steps need accounts that only the repository owner has.

### One-time setup

1. Create a publisher at <https://marketplace.visualstudio.com/manage>. Its ID must match `publisher` in `extension/package.json` (currently `joshwu108`); change one or the other so they agree.
2. Create an Azure DevOps personal access token with the **Marketplace: Manage** scope, for all accessible organisations.
3. For Open VSX (used by Cursor, Windsurf and VSCodium): create an account at <https://open-vsx.org>, sign the publisher agreement, create an access token, then run `npx ovsx create-namespace joshwu108 -p <token>` once.

### Each release

```bash
cd extension
# bump "version" in package.json and add an entry to CHANGELOG.md
npm run test:integration
npm run package                                  # writes codeatlas-<version>.vsix

npx vsce login joshwu108                          # paste the Azure DevOps token
npx vsce publish --no-dependencies               # VS Code Marketplace
npx ovsx publish codeatlas-<version>.vsix -p <open-vsx token>
```

Try the packaged file before publishing: `code --install-extension codeatlas-<version>.vsix`, open a folder that has `.codeatlas/map.json`, and check the lenses, the panel and a jump to code.
