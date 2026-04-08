import fs from 'node:fs'
import * as types from './tres-types'

function groupLinesByHeader(lines: string[]): string[][] {
  const groupedLines: string[][] = [];
  let currentGroup: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0 || line.startsWith('[')) {
      groupedLines.push(currentGroup);
      currentGroup = [];
    } else {
      currentGroup.push(line);
    }
  }
  return groupedLines;
}

export function parseResourceFile(filePath: string): types.ResourceFile {
  const fileContent = fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0);
  const groupedLines = groupLinesByHeader(fileContent);

  const resources: types.Resource[] = groupedLines.map((res) => {
    const header = parseResourceHeader(res[0]);
    const properties = res.slice(1).map((prop) => parseResourceProperty(prop));
    return { header, properties } as types.Resource;
  });

  if (resources[0].properties.length > 0) {
    throw new Error("Base resource has properties.");
  }

  const fileHeader = resources[0].header;
  const file = new types.ResourceFile(fileHeader, resources.slice(1));
  file.validate();

  return file as types.ResourceFile;
}

export function parseResourceHeader(line: string): types.ResourceHeader {
  if (!line.startsWith('[') || !line.endsWith(']')) {
    throw new Error(`Invalid resource header: ${line}`);
  }
  
  const things = /([^ \]\[]+)/gm.exec(line);
  if (!things) {
    throw new Error("Empty resource header string.");
  }

  const type = things[0] as types.ResourceType;
  const modifiers = things.slice(1).map((modifier) => {
    const [name, value] = modifier.split('=');
    return { name, value } as types.ResourceTypeModifier;
  });

  return new types.ResourceHeader(type, modifiers);
}

export function parseResourceProperty(line: string): types.ResourceProperty {
  const property = /([^ =]+) = (.*)/gm.exec(line);
  if (!property) {
    throw new Error(`Invalid resource property: ${line}`);
  }
  
  const name = property[0] as types.ResourcePath;
  const value = property[1] as string;
  
  return { name, value } as types.ResourceProperty;
}