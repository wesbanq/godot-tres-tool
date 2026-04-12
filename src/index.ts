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
  outputExt: string,
  outSuffix: string = ''
): string {
  if (outputOpt === undefined || outputOpt === '') {
    const { dir, name } = path.parse(inputPath);
    return path.join(dir, `${name}${outSuffix}${outputExt}`);
  }
  const endsWithSep = /[/\\]$/.test(outputOpt);
  const stats = fs.existsSync(outputOpt) ? fs.statSync(outputOpt) : null;
  const isDirectory = stats?.isDirectory() ?? false;
  if (isDirectory || endsWithSep) {
    const dir = outputOpt.replace(/[/\\]+$/, '') || outputOpt;
    const { name } = path.parse(inputPath);
    return path.join(dir, `${name}${outSuffix}${outputExt}`);
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
  outputExt: string,
  outSuffix: string = ''
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
      outPath = resolveConvertedOutputPath('stdin', outputOpt, outputExt, outSuffix);
    }
  } else {
    outPath = resolveConvertedOutputPath(path!, outputOpt, outputExt, outSuffix);
  }

  return { content, outPath, fromStdin };
}


function resourceToJsonText(doc: types.ResourceFile | Record<string, unknown>, minified?: boolean): string {
  return doc instanceof types.ResourceFile
    ? doc.toJSON(!!minified)
    : JSON5.stringify(doc, null, minified ? undefined : 2)
}

/**
 * Write CLI result: stdout when `--stdout` or no output path; otherwise UTF-8 file.
 * Raw `text` is written as-is. A resource `doc` becomes `.tres` via the serializer or pretty JSON5 otherwise.
 */
function writeCliOutput(
  opts: { stdout?: boolean },
  outPath: string | undefined,
  payload: string | types.ResourceFile | Record<string, unknown>,
  jsonFormat?: { minified?: boolean }
): void {
  const useStdout = !!opts.stdout || outPath === undefined
  if (typeof payload === 'string') {
    if (useStdout) console.log(payload)
    else fs.writeFileSync(outPath!, payload, 'utf8')
    return
  }
  const doc = payload
  if (useStdout) {
    console.log(resourceToJsonText(doc, jsonFormat?.minified))
    return
  }
  const ext = path.extname(outPath!).toLowerCase()
  if (ext === '.tres') {
    const file = doc instanceof types.ResourceFile ? doc : types.ResourceFile.fromJSON(doc as unknown)
    const result = serializer.serializeResourceFile(file)
    if (!result.ok) {
      throw new parser.ParseAggregateError(result.issues.map((i) => i.message))
    }
    fs.writeFileSync(outPath!, result.value, 'utf8')
  } else {
    fs.writeFileSync(outPath!, resourceToJsonText(doc, jsonFormat?.minified), 'utf8')
  }
}

const cli = cac();

cli.option('-d, --debug', 'Show debug information', { default: false });
cli.option('-s, --stdout', 'Output to stdout', { default: false });
cli.option('-o, --output <path>', 'Output to a specific path', { default: undefined });

cli.command('json [path]', 'Convert a .tres file to a JSON file (stdin if path omitted)')
  .option('-m, --minified', 'Minify the output')
  .action((path: string | undefined, options) => {
    const { content, outPath } = readCliInput(path, options.output, '.json');
    const file = parser.parseResourceContentStrict(content);
    writeCliOutput(options, outPath, file, { minified: options.minified })
  });

cli.command('tres [path]', 'Convert a JSON file to a .tres file (stdin if path omitted)')
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
    writeCliOutput(options, outPath, toTres.value)
  });

cli.command('get [path] <query>', 'Get data from a resource file')
  .action((path: string | undefined, query: string, options) => {
    const isJSON = path === undefined || path.endsWith('.json');

    if (isJSON) {
      const { content } = readCliInput(path, options.output, '');
      const file = JSON5.parse(content);
      const data = JSONPath({ path: query, json: file });
      console.log(JSON5.stringify(data, null, 2));
    } else {
      const { content } = readCliInput(path, options.output, '');
      const file = parser.parseResourceContentStrict(content);
      const data = JSONPath({ path: query, json: file });
      console.log(JSON5.stringify(data, null, 2));
    }
  });

cli.command('delete [path] <query>', 'Delete data from a resource file')
  .action((path: string | undefined, query: string, options) => {
    const isJSON = path === undefined || path.endsWith('.json');

    let out: string | undefined;
    let file: types.ResourceFile;
    if (isJSON) {
      const { content, outPath } = readCliInput(path, options.output, '.json', '_delete');
      out = outPath;
      const parsed = types.resourceFileSchema.safeParse(JSON5.parse(content));
      if (!parsed.success) {
        zodParseErrorMessage(parsed.error);
      }
      file = parsed.data as types.ResourceFile;
    } else {
      const { content, outPath } = readCliInput(path, options.output, '.tres', '_delete');
      out = outPath;
      file = parser.parseResourceContentStrict(content);
    }

    const data = JSONPath({ path: query, json: file, resultType: 'all' });
    data.sort((a: any, b: any) => {
      const d = (b.path?.length ?? 0) - (a.path?.length ?? 0)
      return d !== 0 ? d : a.parent === b.parent ? +String(b.parentProperty) - +String(a.parentProperty) : 0
    })
    for (const m of data) {
      const p = m.parent
      const k = m.parentProperty
      if (p == null || k === undefined) continue;
      Array.isArray(p) ? p.splice(+k, 1) : delete (p as Record<PropertyKey, unknown>)[k as PropertyKey]
    }
    analyzeResourceFile(file);

    writeCliOutput(options, out, file);
    console.log(`Deleted ${data.length} entries from file.`);
  });

cli.command('set [path] <query> <value>', 'Set data in a resource file')
  .action((path: string | undefined, query: string, value: string, options) => {
    const isJSON = path === undefined || path.endsWith('.json');
    const parsedValue = yaml.load(value);

    let out: string | undefined;
    let file: types.ResourceFile;
    if (isJSON) {
      const { content, outPath } = readCliInput(path, options.output, '.json', '_set');
      out = outPath;
      const parsed = types.resourceFileSchema.safeParse(JSON5.parse(content));
      if (!parsed.success) {
        zodParseErrorMessage(parsed.error);
      }
      file = parsed.data as types.ResourceFile;
    } else {
      const { content, outPath } = readCliInput(path, options.output, '.tres', '_set');
      out = outPath;
      file = parser.parseResourceContentStrict(content);
    }

    const data = JSONPath({ path: query, json: file, resultType: 'all' });
    data.forEach((match: any) => {
      match.parent[match.parentProperty] = parsedValue;
    });
    analyzeResourceFile(file);

    writeCliOutput(options, out, file)
    console.log(`Set ${data.length} entries in file.`);
  });

cli.command('append [path] <query> <value>', 'Append data to a resource file')
  .action((path: string | undefined, query: string, value: string, options) => {
    const isJSON = path === undefined || path.endsWith('.json');
    const parsedValue = yaml.load(value);

    let out: string | undefined;
    let file: types.ResourceFile;
    if (isJSON) {
      const { content, outPath } = readCliInput(path, options.output, '.json', '_append');
      out = outPath;
      const parsed = types.resourceFileSchema.safeParse(JSON5.parse(content));
      if (!parsed.success) {
        zodParseErrorMessage(parsed.error);
      }
      file = parsed.data as types.ResourceFile;
    } else {
      const { content, outPath } = readCliInput(path, options.output, '.tres', '_append');
      out = outPath;
      file = parser.parseResourceContentStrict(content);
    }

    const data = JSONPath({ path: query, json: file, resultType: 'all' });
    if (!data.length) throw new Error('No matches for query.')
    const seen = new Set<unknown[]>()
    for (const m of data) {
      const p = m.parent
      const k = m.parentProperty
      if (p == null || k === undefined) throw new Error('Invalid JSONPath match.')
      const t = (Array.isArray(p) ? p[+k] : (p as Record<PropertyKey, unknown>)[k as PropertyKey]) as unknown
      if (!Array.isArray(t)) throw new Error('Append target must be an array.')
      if (seen.has(t)) continue
      seen.add(t)
      t.push(parsedValue)
    }
    analyzeResourceFile(file);

    writeCliOutput(options, out, file)
    console.log(`Appended ${data.length} entries to file.`);
  });

cli.help();
cli.version('0.1.2');

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