import cac from 'cac'
import fs from 'fs';
import * as parser from './parser';

const cli = cac()

cli.command('json [path]', 'Convert a .tres file to a JSON file')
  .option('-s, --stdout', 'Output to stdout')
  .action((path, options) => {
    const file = parser.parseResourceFile(path);
    if (options.stdout) {
      console.log(file.toJSON());
    } else {
      fs.writeFileSync(path.replace('.tres', '.json'), file.toJSON());
    }
});

cli.command('tres [path]', 'Convert a JSON file to a .tres file')
  .option('-s, --stdout', 'Output to stdout')
  .action((path, options) => {
    const file = JSON.parse(fs.readFileSync(path, 'utf8'));
    if (options.stdout) {
      console.log(file.toTres());
    } else {
      fs.writeFileSync(path.replace('.json', '.tres'), file.toTres());
    }
});

cli.help()
cli.version('0.0.2')