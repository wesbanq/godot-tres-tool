/**
 * CLI: convert Godot `.tres` text resources to JSON and back.
 */
import cac from 'cac'
import fs from 'fs';
import path from 'node:path';
import { z, ZodError } from 'zod';
import * as analyzer from './analyzer';
import { IssueSeverity } from './errors';
import * as parser from './parser';
import * as serializer from './serializer';
import * as types from './tres-types';
import * as tools from './tools';

function requireAnalyzerClean(file: types.ResourceFile): void {
  const issues = analyzer.analyzeResourceFile(file);
  const errors = issues.filter((i) => i.severity === IssueSeverity.Error);
  if (errors.length > 0) {
    throw new parser.ParseAggregateError(errors.map((e) => e.message));
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

const changeResPathsSchema = z.tuple([types.resourceResSchema, types.resourceResSchema]);

/** Logical basename for {@link resolveConvertedOutputPath} when input is stdin. */
const STDIN_LOGICAL_PATH = 'stdin';

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
      outPath = resolveConvertedOutputPath(STDIN_LOGICAL_PATH, outputOpt, outputExt);
    }
  } else {
    outPath = resolveConvertedOutputPath(path!, outputOpt, outputExt);
  }

  return { content, outPath, fromStdin };
}

const cli = cac();

cli.option('-d, --debug', 'Show debug information', { default: false });

cli.command('json [path]', 'Convert a .tres file to a JSON file (stdin if path omitted)')
  .option('-m, --minified', 'Minify the output')
  .option('-s, --stdout', 'Output to stdout')
  .option('-o, --output <path>', 'Output to a specific path')
  .action((path: string | undefined, options) => {
    const { content, outPath } = readCliInput(path, options.output, '.json');
    const file = parser.parseResourceContent(content);
    requireAnalyzerClean(file);
    let text = file.toJSON(options.minified);
    if (options.stdout || outPath === undefined) {
      console.log(text);
    } else {
      fs.writeFileSync(outPath, text);
    }
  });

cli.command('tres [path]', 'Convert a JSON file to a .tres file (stdin if path omitted)')
  .option('-s, --stdout', 'Output to stdout')
  .option('-o, --output <path>', 'Output to a specific path')
  .action((path: string | undefined, options) => {
    const { content, outPath } = readCliInput(path, options.output, '.tres');
    const { errors, file } = serializer.deserializeResourceFileFromJsonWithErrors(content);
    if (errors.length > 0) {
      throw new parser.ParseAggregateError(errors);
    }
    requireAnalyzerClean(file!);
    const text = serializer.serializeResourceFile(file!);
    if (options.stdout || outPath === undefined) {
      console.log(text);
    } else {
      fs.writeFileSync(outPath, text);
    }
  });

cli.command('change-res [file] <oldPath> <newPath>', 'Change the res path of a resource file')
  .option('-o, --output <path>', 'Output to a specific path')
  .action((file, oldPath, newPath, options) => {
    const { content, outPath } = readCliInput(file, options.output, '.tres');
    const [from, to] = changeResPathsSchema.parse([oldPath, newPath]);
    const parsedFile = parser.parseResourceContent(content);
    requireAnalyzerClean(parsedFile);
    const newFile = tools.changeResPath(parsedFile, from, to);
    const text = serializer.serializeResourceFile(newFile);
    if (options.stdout || outPath === undefined) {
      console.log(text);
    } else {
      fs.writeFileSync(outPath, text);
    }
  });

cli.help()
cli.version('0.0.5')

try {
  cli.parse();
} catch (e) {
  if (cli.options.debug) {
    throw e;
  }
  if (e instanceof ZodError) {
    console.error(types.formatZodError(e));
  } else if (e instanceof Error) {
    console.error(e.message);
  } else {
    console.error('An unknown error occurred');
  }
  process.exit(1);
}