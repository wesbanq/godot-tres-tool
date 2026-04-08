import cac from 'cac'
import fs from 'fs';
import * as parser from './parser';

function validatePath(path: string): void {
  if (!path || !fs.existsSync(path)) {
    throw new Error('File does not exist');
  }
}

const cli = cac();

cli.option('-d, --debug', 'Show debug information', { default: false });

cli.command('json <path>', 'Convert a .tres file to a JSON file')
  .option('-s, --stdout', 'Output to stdout')
  .option('-o, --output <path>', 'Output to a specific path')
  .action((path, options) => {
    validatePath(path);

    const file = parser.parseResourceFile(path);
    if (options.stdout) {
      console.log(file.toJSON());
    } else {
      fs.writeFileSync(options.output || path.replace('.tres', '.json'), file.toJSON());
    }
});

cli.command('tres <path>', 'Convert a JSON file to a .tres file')
  .option('-s, --stdout', 'Output to stdout')
  .option('-o, --output <path>', 'Output to a specific path')
  .action((path, options) => {
    validatePath(path);

    const file = JSON.parse(fs.readFileSync(path, 'utf8'));
    if (options.stdout) {
      console.log(file.toTres());
    } else {
      fs.writeFileSync(options.output || path.replace('.json', '.tres'), file.toTres());
    }
});

cli.help()
cli.version('0.0.2')

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