# Development Guide

This guide explains how to build, run, and test the plugin locally.

## Prerequisites

- [Bun](https://bun.sh/) (latest version)
- [Git](https://git-scm.com/)
- An Obsidian vault for testing

## Setup

### Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
cd YOUR_REPO_NAME
```

### Install Dependencies

```bash
bun install
```

### Configure Vault Location

Set the `OBSIDIAN_VAULT_LOCATION` environment variable to your vault path. The build script uses this to copy the plugin files directly to your vault for testing.

#### Windows (PowerShell)

```powershell
# Set temporarily for current session
$env:OBSIDIAN_VAULT_LOCATION="C:\Users\YourName\Documents\ObsidianVault"

# Set permanently for your user
[System.Environment]::SetEnvironmentVariable('OBSIDIAN_VAULT_LOCATION', 'C:\Users\YourName\Documents\ObsidianVault', 'User')
```

#### Linux

```bash
# Set temporarily for current session
export OBSIDIAN_VAULT_LOCATION="/home/yourname/Documents/ObsidianVault"

# Set permanently (add to ~/.bashrc or ~/.zshrc)
echo 'export OBSIDIAN_VAULT_LOCATION="/home/yourname/Documents/ObsidianVault"' >> ~/.bashrc
source ~/.bashrc
```

#### macOS

```bash
# Set temporarily for current session
export OBSIDIAN_VAULT_LOCATION="/Users/yourname/Documents/ObsidianVault"

# Set permanently (add to ~/.zshrc or ~/.bash_profile)
echo 'export OBSIDIAN_VAULT_LOCATION="/Users/yourname/Documents/ObsidianVault"' >> ~/.zshrc
source ~/.zshrc
```

## Development Workflow

### Start Development Mode

Run the development build with file watching:

```bash
bun run dev
```

This will:

- Compile TypeScript
- Bundle the plugin
- Build Tailwind CSS
- Copy files to your vault's plugin directory
- Watch for changes and rebuild automatically

### Type Checking

Run TypeScript type checking in watch mode:

```bash
bun run tsc:watch
```

Keep this running in a separate terminal to catch type errors as you code.

### Run Tests

```bash
bun test
```

Run tests in watch mode:

```bash
bun test --watch
```

### Linting and Formatting

```bash
bun run lint        # Check for lint errors
bun run lint:fix    # Auto-fix lint errors
bun run format      # Format code with Prettier
bun run format:check # Check formatting without changes
```

## Building for Production

```bash
bun run build
```

This creates optimized production files in the `dist/` directory:

- `main.js` - Bundled plugin code
- `manifest.json` - Plugin manifest
- `styles.css` - Compiled styles

## Testing in Obsidian

1. Ensure `OBSIDIAN_VAULT_LOCATION` is set correctly
2. Run `bun run dev` to build and copy files to your vault
3. Open Obsidian
4. Go to **Settings → Community plugins**
5. Disable Safe Mode if prompted
6. Find and enable the plugin
7. After making changes, Obsidian will automatically reload the plugin (or use **Ctrl/Cmd + R** to reload)

### Manual Installation

If you prefer not to use the environment variable, manually copy these files to `<YourVault>/.obsidian/plugins/<your-plugin-id>/`:

- `dist/main.js`
- `dist/manifest.json`
- `dist/styles.css`

## Available Scripts

| Script                 | Description                       |
| ---------------------- | --------------------------------- |
| `bun run dev`          | Development build with watch mode |
| `bun run build`        | Production build                  |
| `bun run tsc`          | Type check                        |
| `bun run tsc:watch`    | Type check in watch mode          |
| `bun run lint`         | Run ESLint                        |
| `bun run lint:fix`     | Fix ESLint errors                 |
| `bun run format`       | Format with Prettier              |
| `bun run format:check` | Check formatting                  |
| `bun test`             | Run tests                         |
| `bun run commit`       | Create a commit with Commitizen   |

## Dependency overrides

`package.json` carries an `overrides` block. A pin belongs there only while a dependent's declared range excludes the patched release of a package with an advisory. When every range accepts the fix, the pin comes out and a plain reinstall resolves the patched version. Each remaining pin, the range that forces it, and the advisory it blocks:

| Pin                                        | Stale range                                                                | Advisory blocked                      | Drop when                                              |
| ------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| `tmp` 0.2.7                                | `external-editor@3.1.0` wants `^0.0.33` (via `inquirer`, via `commitizen`) | GHSA-ph9p-34f9-6g65 (high) in 0.0.33  | `external-editor` or `commitizen` moves to `tmp` 0.2.x |
| `lodash` 4.18.1                            | `commitizen@4.3.1` pins `4.17.21` exactly                                  | GHSA-r5fr-rjxr-66jc (high) in 4.17.21 | `commitizen` releases with a newer `lodash`            |
| `@conventional-changelog/git-client` 2.7.0 | `git-raw-commits@5.0.0` and `git-semver-tags@8.0.0` want `^1.0.0`          | GHSA-vh25-5764-9wcr (medium) in 1.0.1 | `conventional-changelog-cli` ships dependents on 2.x   |

The last one forces a major version on two packages that did not ask for it. The release tooling (`bun scripts/calculate-next-version.ts`, `bun run release`) is the check that it still works; run it after touching that pin.

One moderate finding remains and is left alone on purpose: `moment` 2.29.4, declared by the `obsidian` typings package as an exact version (`2.29.4`, not a range), GHSA-4p3w-j4w9-5jqw. It cannot move within range because there is no range, and an override would force a version onto a package that deliberately pins it. It is also dev only: nothing under `src/` bundles `moment` (the production `main.js` contains no reference to it), and at runtime the plugin uses whatever `moment` Obsidian itself ships. The right fix is an `obsidian` release that raises the pin.

To re-check the block, list every dependent's range from `bun.lock` and test the pinned version against it; `bun audit --audit-level=high` after removing a pin says whether it was still needed. Do not use `bun update <name>` on a package that is not a direct dependency: it adds the package to `devDependencies` instead of updating the lockfile entry.

## Troubleshooting

### Plugin not appearing in Obsidian

- Verify `OBSIDIAN_VAULT_LOCATION` points to the correct vault
- Check that files exist in `<vault>/.obsidian/plugins/<your-plugin-id>/`
- Restart Obsidian
- Ensure Community plugins are enabled

### Build errors

- Run `bun install` to ensure dependencies are up to date
- Check `bun run tsc` for TypeScript errors
- Check `bun run lint` for linting issues

### Changes not reflecting

- Use **Ctrl/Cmd + R** in Obsidian to reload
- Check the developer console (**Ctrl/Cmd + Shift + I**) for errors
