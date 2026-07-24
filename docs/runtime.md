# shorts-factory Runtime

## Decision

The first app runtime is a local Node HTTP server.

This keeps the MVP simple: one `npm run app` command serves the static console and exposes local-only APIs for project files and CLI commands. Electron or Tauri can be added later when installer, tray, file picker, and background job needs are clear.

## Start

```bash
npm run app
```

Default URL:

```text
http://127.0.0.1:4173/
```

If the port is already in use:

```bash
PORT=4174 npm run app
```

## Safety Boundary

The runtime only accepts project paths inside the current workspace. Attempts to read or write outside the workspace are rejected.

The app can still download or copy YAML without the API. Local save, validate, render, and package buttons require `npm run app`.

## API

`GET /api/health`

Returns runtime status and workspace root.

`POST /api/project/write`

Body:

```json
{
  "yaml": "projectName: my-project\n"
}
```

Writes `project.yaml` under `projects/<projectName>/` unless `projectDir` is provided and stays inside the workspace.

`GET /api/project/read?projectPath=<path>`

Reads `project.yaml` from a project folder or a direct `.yaml` path.

`POST /api/validate`

Runs:

```bash
npm run dev -- validate <projectPath>
```

`POST /api/render`

Runs:

```bash
npm run dev -- render <projectPath>
```

`POST /api/package`

Runs:

```bash
npm run dev -- package <projectPath>
```

Each command response includes `ok`, `exitCode`, `stdout`, and `stderr`. The current progress channel is request/response output capture; streaming progress can be added when render jobs become long enough to need live logs.

## Verification

Runtime coverage lives in `scripts/local-server.test.mjs`.

The full gate is:

```bash
npm run verify
```
