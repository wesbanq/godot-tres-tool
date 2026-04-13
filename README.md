# godot-tres-tool

Small library/CLI for creating, reading, and editing Godot’s text resource format (`.tres`).

## Overview

The CLI reads a file path you pass to a subcommand, or **stdin** when the path is omitted (see **Stdin and output** below).

- **`json`** parses a `.tres` file into a structured document (root `gd_resource` header plus an array of resource blocks) and writes **strict JSON** text.
- **`tres`** does the reverse: it reads **JSON5** (loose JSON: comments, trailing commas, etc.) in that shape and writes Godot-compatible `.tres` text.
- **`get`** runs a [JSONPath](https://github.com/JSONPath-Plus/JSONPath-Plus) query and prints matching values as JSON.
- **`delete`**, **`set`**, and **`append`** mutate the in-memory model via JSONPath, then re-validate and write the result (`.tres` or strict JSON) using the same rules as `json` / `tres`.

**Input**

- **`json`**: A normal Godot `.tres` file. The first section must be `[gd_resource …]` with no property lines under it; following sections are parsed as resources.
- **`tres`**: JSON or JSON5 with `header` and `resources` matching the internal schema (e.g. output from this tool’s `json` command). Hand-written JSON may not round-trip.
- **`get` / `delete` / `set` / `append`**: Either a `.tres` file or a `.json` file in the tool’s format. **If you omit the path and read from stdin, input is always parsed as JSON5** (not `.tres` text).

**Output**

- By default, the result is written next to the input file: same directory and base name, with `.json` or `.tres` appended (or a suffix for mutating commands; see below).
- With **`-o` / `--output`**: if the value is an existing directory, or ends with `/` or `\`, the output file is placed inside it using the input’s base name and the right extension. Otherwise `-o` is treated as the full output file path.
- With **`-s` / `--stdout`**, or when there is **no output path** (e.g. stdin without `-o`), the result is printed to stdout and no file is written.

**Mutating commands default filenames**

For **`delete`**, **`set`**, and **`append`**, the default output basename is the input name plus a suffix before the extension, e.g. `cube.tres` → `cube_delete.tres`, `cube_set.tres`, `cube_append.tres` (and the same idea for `.json`). Use `-o` to pick an explicit path.

**`set` and `append` values**

The `<value>` argument is parsed with **YAML** (via [js-yaml](https://github.com/nodeca/js-yaml)), so you can pass scalars, mappings, and sequences using YAML syntax on the command line (quoting as needed for your shell).

## Usage

From the repo root, use either **Node** (`npm run start` runs TypeScript via [tsx](https://github.com/privatenumber/tsx)) or **Bun**:

```bash
npm run start -- <command> [options]
```

Or:

```bash
bun run src/index.ts <command> [options]
```

`npm run build` runs the TypeScript compiler with **no emit** (`noEmit: true` in `tsconfig.json`)—it typechecks the project only.

## Commands

| Command | Description |
|--------|-------------|
| `json [path]` | Convert a `.tres` file to JSON. Stdin if `path` is omitted. |
| `tres [path]` | Convert JSON/JSON5 (this tool’s format) to `.tres`. Stdin if `path` is omitted. |
| `get [path] <query>` | JSONPath query against a resource file (`.tres` or `.json`); stdin is parsed as JSON5. |
| `delete [path] <query>` | Remove values matched by JSONPath; writes updated file (or stdout). |
| `set [path] <query> <value>` | Set matched locations to the YAML-parsed `value`. |
| `append [path] <query> <value>` | Append YAML-parsed `value` to each distinct array matched by `query`. |

For file inputs, `<path>` must exist when provided. Mutating commands run structural checks after edits; validation errors exit non-zero (use `--debug` for a stack trace).

## Options

### Global (all commands)

| Option | Description |
|--------|-------------|
| `-h`, `--help` | Show help. |
| `-v`, `--version` | Show version (currently `0.1.2`). |
| `-d`, `--debug` | On errors, print the full stack trace instead of only the message. |
| `-s`, `--stdout` | Write the main result to stdout instead of a file. |
| `-o`, `--output <path>` | Output file or directory (see **Output** above). |

### `json` only

| Option | Description |
|--------|-------------|
| `-m`, `--minified` | Emit a single-line minified JSON (no pretty-printing). |

## Stdin and output

- **`json`** / **`tres`**: Omit `[path]` to read UTF-8 from stdin. If you do **not** pass `-o`, the converted output goes to **stdout** (same as `-s`).
- **`get`**: Stdin is parsed as **JSON5** only.
- **`delete`**, **`set`**, **`append`**: Stdin is parsed as **JSON5** only; updated `.json` output is strict JSON. Without `-o`, the updated document is written to **stdout**.

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

# Pipe .tres → JSON on stdout
cat cube.tres | bun run src/index.ts json

# JSONPath: header type
bun run src/index.ts get ./cube.tres '$.header.type'

# Set a property value (YAML scalar); writes cube_set.tres by default
bun run src/index.ts set ./cube.tres '$.resources[0].properties[0].value' 'hello'
```

## JSON Schema

Zod schemas in `src/tres-types.ts` can be exported as JSON Schema for tooling:

```bash
npm run generate:schemas
```

Generated files live under `schemas/` (e.g. `resourceFileSchema.json`).

## License

See [LICENSE](LICENSE).
