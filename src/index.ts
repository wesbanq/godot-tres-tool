/**
 * CLI: convert Godot `.tres` text resources to JSON and back.
 */
import cac from 'cac'
import fs from 'fs';
import path from 'node:path';
import { z, ZodError } from 'zod';
import * as parser from './parser';
import * as serializer from './serializer';
import * as types from './tres-types';
import { JSONPath } from 'jsonpath-plus';
import { formatZodError, zodParseErrorMessage, IssueSeverity } from './errors';
import * as analyzer from './analyzer';
import JSON5 from 'json5';
import * as yaml from 'js-yaml';

function analyzeResourceFile(file: types.ResourceFile): void {
  const issues = analyzer.analyzeResourceFile(file);
  if (issues.some((i) => i.severity >= IssueSeverity.Error)) {
    throw new parser.ParseAggregateError(issues.map((i) => i.message));
  }
}

const existingFilePathSchema = z
  .string()
  .min(1, 'File path is required')
  .refine((p) => fs.existsSync(p), 'File does not exist');

/** Throws if `filePath` is empty or missing on disk. */
function validatePath(filePath: string): void {
  existingFilePathSchema.parse(filePath);
}

function readStdinUtf8Sync(): string {
  return fs.readFileSync(0, 'utf8');
}

/**
 * Directory if it exists as a dir, or path ends with a separator; otherwise a concrete output file path.
 * `outputExt` includes the dot (e.g. `.json`, `.tres`).
 */
function resolveConvertedOutputPath(
  inputPath: string,
  outputOpt: string | undefined,
  outputExt: string
): string {
  if (outputOpt === undefined || outputOpt === '') {
    const { dir, name } = path.parse(inputPath);
    return path.join(dir, `${name}${outputExt}`);
  }
  const endsWithSep = /[/\\]$/.test(outputOpt);
  const stats = fs.existsSync(outputOpt) ? fs.statSync(outputOpt) : null;
  const isDirectory = stats?.isDirectory() ?? false;
  if (isDirectory || endsWithSep) {
    const dir = outputOpt.replace(/[/\\]+$/, '') || outputOpt;
    const { name } = path.parse(inputPath);
    return path.join(dir, `${name}${outputExt}`);
  }
  return outputOpt;
}

/**
 * Reads UTF-8 input from a file path or stdin (when `path` is omitted or empty),
 * and resolves the default or `-o` output path.
 * Stdin with no `--output` yields `outPath: undefined` (use `--stdout` or `-o`).
 */
function readCliInput(
  path: string | undefined,
  outputOpt: string | undefined,
  outputExt: string
): { content: string; outPath: string | undefined; fromStdin: boolean } {
  const fromStdin = path === undefined || path === '';
  if (!fromStdin) {
    validatePath(path);
  }

  const content = fromStdin ? readStdinUtf8Sync() : fs.readFileSync(path!, 'utf8');

  let outPath: string | undefined;
  if (fromStdin) {
    if (outputOpt === undefined || outputOpt === '') {
      outPath = undefined;
    } else {
      outPath = resolveConvertedOutputPath('stdin', outputOpt, outputExt);
    }
  } else {
    outPath = resolveConvertedOutputPath(path!, outputOpt, outputExt);
  }

  return { content, outPath, fromStdin };
}

interface JsonPathMatch {
  path?: (string | number)[]
  parent?: unknown
  parentProperty?: string | number
}

/**
 * Apply JSONPath matches in-place: remove array elements with `splice` (no `null` placeholders)
 * and remove object properties with `delete`. Nested arrays are updated before ancestor arrays
 * so indices stay meaningful; within one array, indices are removed high-to-low.
 */
function removeJsonPathMatches(matches: JsonPathMatch[]): void {
  const arrayGroups = new Map<unknown[], { indices: Set<number>; maxDepth: number }>()
  const objectDeletes: { parent: Record<PropertyKey, unknown>; key: PropertyKey }[] = []

  for (const m of matches) {
    if (m.parent == null || m.parentProperty === undefined) {
      continue
    }
    const { parent } = m
    const prop = m.parentProperty

    if (Array.isArray(parent)) {
      const idx = typeof prop === 'number' ? prop : Number(prop)
      if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) {
        continue
      }
      let g = arrayGroups.get(parent)
      if (g === undefined) {
        g = { indices: new Set(), maxDepth: 0 }
        arrayGroups.set(parent, g)
      }
      g.indices.add(idx)
      const depth = Array.isArray(m.path) ? m.path.length : 0
      if (depth > g.maxDepth) {
        g.maxDepth = depth
      }
    } else if (typeof parent === 'object') {
      objectDeletes.push({ parent: parent as Record<PropertyKey, unknown>, key: prop as PropertyKey })
    }
  }

  const sortedArrays = [...arrayGroups.entries()].sort((a, b) => b[1].maxDepth - a[1].maxDepth)

  for (const [arr, { indices }] of sortedArrays) {
    for (const i of [...indices].sort((x, y) => y - x)) {
      if (i < arr.length) {
        arr.splice(i, 1)
      }
    }
  }

  for (const { parent, key } of objectDeletes) {
    delete parent[key]
  }
}

const cli = cac();

cli.option('-d, --debug', 'Show debug information', { default: false });
cli.option('-s, --stdout', 'Output to stdout', { default: false });

cli.command('json [path]', 'Convert a .tres file to a JSON file (stdin if path omitted)')
  .option('-m, --minified', 'Minify the output')
  .option('-o, --output <path>', 'Output to a specific path')
  .action((path: string | undefined, options) => {
    const { content, outPath } = readCliInput(path, options.output, '.json');
    const file = parser.parseResourceContentStrict(content);
    let text = file.toJSON(options.minified);

    if (options.stdout || outPath === undefined) {
      console.log(text);
    } else {
      fs.writeFileSync(outPath, text);
    }
  });

cli.command('tres [path]', 'Convert a JSON file to a .tres file (stdin if path omitted)')
  .option('-o, --output <path>', 'Output to a specific path')
  .action((path: string | undefined, options) => {
    const { content, outPath } = readCliInput(path, options.output, '.tres');
    const fromJson = serializer.deserializeResourceFileFromJson(content);
    if (!fromJson.ok) {
      throw new parser.ParseAggregateError(fromJson.issues.map((i) => i.message));
    }
    const toTres = serializer.serializeResourceFile(fromJson.value);
    if (!toTres.ok) {
      throw new parser.ParseAggregateError(toTres.issues.map((i) => i.message));
    }
    const text = toTres.value;
    if (options.stdout || outPath === undefined) {
      console.log(text);
    } else {
      fs.writeFileSync(outPath, text);
    }
  });

cli.command('get [path] <query>', 'Get data from a resource file')
  .action((path: string | undefined, query: string, options) => {
    const isJSON = path === undefined || path.endsWith('.json');

    if (isJSON) {
      const { content } = readCliInput(path, undefined, '');
      const file = JSON5.parse(content);
      const data = JSONPath({ path: query, json: file });
      console.log(JSON5.stringify(data, null, 2));
    } else {
      const { content } = readCliInput(path, undefined, '');
      const file = parser.parseResourceContentStrict(content);
      const data = JSONPath({ path: query, json: file });
      console.log(JSON5.stringify(data, null, 2));
    }
  });

cli.command('delete [path] <query>', 'Delete data from a resource file')
  .action((path: string | undefined, query: string, options) => {
    const isJSON = path === undefined || path.endsWith('.json');

    let outPath: string | undefined;
    let file: types.ResourceFile;
    if (isJSON) {
      const { content, outPath: outPath } = readCliInput(path, undefined, '.json');
      const parsed = types.resourceFileSchema.safeParse(JSON5.parse(content));
      if (!parsed.success) {
        zodParseErrorMessage(parsed.error);
      }
      file = parsed.data as types.ResourceFile;
    } else {
      const { content, outPath: outPath } = readCliInput(path, undefined, '.tres');
      file = parser.parseResourceContentStrict(content);
    }

    const data = JSONPath({ path: query, json: file, resultType: 'all' });
    removeJsonPathMatches(data)
    analyzeResourceFile(file);

    if (options.stdout || outPath === undefined) {
      console.log(file.toJSON());
    } else {
      fs.writeFileSync(outPath!, file.toJSON());
    }
    console.log(`Deleted ${data.length} entries from file.`);
  });

cli.command('set [path] <query> <value>', 'Set data in a resource file')
  .action((path: string | undefined, query: string, value: string, options) => {
    const isJSON = path === undefined || path.endsWith('.json');
    const parsedValue = yaml.load(value);

    let outPath: string | undefined;
    let file: types.ResourceFile;
    if (isJSON) {
      const { content, outPath: outPath } = readCliInput(path, undefined, '.json');
      const parsed = types.resourceFileSchema.safeParse(JSON5.parse(content));
      if (!parsed.success) {
        zodParseErrorMessage(parsed.error);
      }
      file = parsed.data as types.ResourceFile;
    } else {
      const { content, outPath: outPath } = readCliInput(path, undefined, '.tres');
      file = parser.parseResourceContentStrict(content);
    }

    const data = JSONPath({ path: query, json: file, resultType: 'all' });
    data.forEach((match: any) => {
      match.parent[match.parentProperty] = parsedValue;
    });
    analyzeResourceFile(file);

    if (options.stdout || outPath === undefined) {
      console.log(file.toJSON());
    } else {
      fs.writeFileSync(outPath!, file.toJSON());
    }
    console.log(`Set ${data.length} entries in file.`);
  });

cli.command('append [path] <query> <value>', 'Append data to a resource file')
  .action((path: string | undefined, query: string, value: string, options) => {
    const isJSON = path === undefined || path.endsWith('.json');
    const parsedValue = yaml.load(value);

    let outPath: string | undefined;
    let file: types.ResourceFile;
    if (isJSON) {
      const { content, outPath: outPath } = readCliInput(path, undefined, '.json');
      const parsed = types.resourceFileSchema.safeParse(JSON5.parse(content));
      if (!parsed.success) {
        zodParseErrorMessage(parsed.error);
      }
      file = parsed.data as types.ResourceFile;
    } else {
      const { content, outPath: outPath } = readCliInput(path, undefined, '.tres');
      file = parser.parseResourceContentStrict(content);
    }

    const data = JSONPath({ path: query, json: file });
    if (data.length > 0) {
      data[0].$append(value);
    } else {
      data.push(value);
    }
    analyzeResourceFile(file);

    if (options.stdout || outPath === undefined) {
      console.log(file.toJSON());
    } else {
      fs.writeFileSync(outPath!, file.toJSON());
    }
    console.log(`Appended ${data.length} entries to file.`);
  });

cli.help();
cli.version('0.1.1');

try {
  cli.parse();
} catch (e) {
  if (cli.options.debug) {
    throw e;
  }
  if (e instanceof ZodError) {
    console.error(formatZodError(e));
  } else if (e instanceof Error) {
    console.error(e.message);
  } else {
    console.error('An unknown error occurred');
  }
  process.exit(1);
}