# Repository Guidelines

## Project Structure & Module Organization

The React and TypeScript renderer lives in `src/`; keep UI components, hooks, and styles close to the feature they support. Electron main-process code and desktop integrations belong in `electron/`. Shared prompt templates and configuration data are stored in `shared/`. Regression and smoke tests are standalone CommonJS scripts under `scripts/`. Static preview images live in `public/style-previews/`, while packaged runtime resources belong in `resources/` and installer artwork in `build/`. Generated output is written to `dist/` and `release/` and should not be edited by hand.

## Build, Test, and Development Commands

- `npm install` installs project dependencies.
- `npm run dev` starts Vite and launches Electron after the renderer is ready.
- `npm run build` type-checks the project and creates the production renderer bundle.
- `npm start` launches Electron against the current built or development files.
- `npm run dist` builds the app and produces the Windows installer in `release/`.
- `npm run test:workflow` runs the main workflow smoke test.
- `npm run test:caption`, `npm run test:reference-routing`, and other `test:*` scripts run focused regressions. Choose tests that match the changed subsystem.

## Coding Style & Naming Conventions

Follow the existing TypeScript and React style: two-space indentation, semicolons, and single quotes where surrounding code uses them. Name React components and classes in `PascalCase`; use `camelCase` for functions, variables, hooks, and IPC handlers. Keep Electron scripts in `.cjs` files and renderer code in `.ts` or `.tsx`. Prefer small, feature-focused modules over adding unrelated logic to large files.

## Testing Guidelines

Tests are Node or Electron regression scripts named `scripts/<feature>-test.cjs`. Add a focused test when fixing workflow state, provider routing, subtitles, rendering, or persistence. Run `npm run build` plus the relevant `test:*` command before submitting. Tests that call external AI services may require local credentials; document skipped or environment-dependent checks in the pull request.

## Commit & Pull Request Guidelines

History uses short, scoped Chinese commit messages such as `修复图片生成的bug` and `调整字幕bug`. Keep commits concise and describe the user-visible area changed; avoid mixing unrelated fixes. Pull requests should summarize behavior changes, list verification commands, link related issues, and include screenshots for UI changes or logs for packaging and provider-integration changes. Never commit secrets, local API keys, generated `dist/` output, or installer artifacts from `release/`.
