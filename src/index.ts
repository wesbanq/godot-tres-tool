import cac from 'cac'
import fs from 'fs';
import path from 'node:path';
import * as parser from './parser';
import * as types from './tres-types';

function validatePath(filePath: string): void {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('File does not exist');
  }
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

const cli = cac();

cli.option('-d, --debug', 'Show debug information', { default: false });

cli.command('json <path>', 'Convert a .tres file to a JSON file')
  .option('-m, --minified', 'Minify the output')
  .option('-s, --stdout', 'Output to stdout')
  .option('-o, --output <path>', 'Output to a specific path')
  .action((path, options) => {
    validatePath(path);

    const file = parser.parseResourceFile(path);
    let text = file.toJSON(options.minified);
    if (options.stdout) {
      console.log(text);
    } else {
      const outPath = resolveConvertedOutputPath(path, options.output, '.json');
      fs.writeFileSync(outPath, text);
    }
  });

cli.command('tres <path>', 'Convert a JSON file to a .tres file')
  .option('-s, --stdout', 'Output to stdout')
  .option('-o, --output <path>', 'Output to a specific path')
  .action((path, options) => {
    validatePath(path);

    const file = types.ResourceFile.fromJSON(fs.readFileSync(path, 'utf8'));
    const text = file.toTres();
    if (options.stdout) {
      console.log(text);
    } else {
      const outPath = resolveConvertedOutputPath(path, options.output, '.tres');
      fs.writeFileSync(outPath, text);
    }
  });

cli.help()
cli.version('0.0.3')

try {
  cli.parse();
} catch (e) {
  if (cli.options.debug) {
    throw e;
  }
  if (e instanceof Error) {
    console.error(e.message);
  } else {
    console.error('An unknown error occurred');
  }
  process.exit(1);
}