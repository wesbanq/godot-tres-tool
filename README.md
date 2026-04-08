# godot-tres-tool

Small library/CLI for creating, reading and editing Godot's resource file format (.tres). 

## Overview

The tool reads a file path you pass to a subcommand. **`json`** parses a `.tres` file into a structured JSON document (root `gd_resource` header plus an array of resource blocks). **`tres`** does the reverse: it reads JSON in that same shape and writes Godot-compatible `.tres` text.

**Input**

- **`json`**: A normal Godot `.tres` file. The first section must be `[gd_resource …]` with no property lines under it; following sections are parsed as resources.
- **`tres`**: JSON produced by this tool’s `json` command (or equivalent: an object with `header` and `resources` matching the internal schema). Arbitrary hand-written JSON may not round-trip.

**Output**

- By default, the result is written next to the input file: same directory and base name, with `.json` or `.tres` appended.
- With **`-o` / `--output`**: if the value is an existing directory, or ends with `/` or `\`, the output file is placed inside it using the input’s base name and the right extension. Otherwise `-o` is treated as the full output file path.
- With **`-s` / `--stdout`**, the result is printed to stdout and no file is written.

## Usage

From the repo root (example with Bun, as in `package.json`):

```bash
bun run src/index.ts <command> [options]
```

After typechecking with `npm run build`, you can run the same entrypoint however you usually execute TypeScript (e.g. Bun or `tsx`).

## Commands

| Command | Description |
|--------|-------------|
| `json <path>` | Convert a `.tres` file to JSON. |
| `tres <path>` | Convert a JSON file (this tool’s format) to `.tres`. |

`<path>` must exist; otherwise the program exits with an error.

## Options

### Global (all commands)

| Option | Description |
|--------|-------------|
| `-h`, `--help` | Show help. |
| `-v`, `--version` | Show version. |
| `-d`, `--debug` | On errors, print the full stack trace instead of only the message. |

### `json` only

| Option | Description |
|--------|-------------|
| `-m`, `--minified` | Emit a single-line minified JSON (no pretty-printing). |
| `-s`, `--stdout` | Write JSON to stdout instead of a file. |
| `-o`, `--output <path>` | Output file or directory (see **Output** above). |

### `tres` only

| Option | Description |
|--------|-------------|
| `-s`, `--stdout` | Write `.tres` text to stdout instead of a file. |
| `-o`, `--output <path>` | Output file or directory (see **Output** above). |

## Examples

```bash
# cube.tres → cube.json beside it
bun run src/index.ts json ./cube.tres

# Pretty-print to stdout
bun run src/index.ts json ./cube.tres -s

# Minified JSON to a specific file
bun run src/index.ts json ./cube.tres -o ./out/cube.json -m

# cube.json → cube.tres beside it
bun run src/index.ts tres ./cube.json

# .tres to stdout
bun run src/index.ts tres ./cube.json -s
```

## License

See [LICENSE](LICENSE).
