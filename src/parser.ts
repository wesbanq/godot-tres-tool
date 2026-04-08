import fs from 'node:fs'
import * as types from './tres-types'

/** Removes paired surrounding `"` repeatedly (Godot may wrap modifier values in quotes). */
function stripOuterQuotes(raw: string): string {
  let s = raw.trim()
  while (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    s = s.slice(1, -1)
  }
  return s
}

/** One group per `[...]` header line and its following non-empty lines until the next header. */
function groupLinesByHeader(lines: string[]): string[][] {
  const groupedLines: string[][] = [];
  let currentGroup: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith('[')) {
      if (currentGroup !== null && currentGroup.length > 0) {
        groupedLines.push(currentGroup);
      }
      currentGroup = [line];
    } else if (line.trim().length > 0) {
      if (currentGroup === null) {
        continue;
      }
      currentGroup.push(line);
    }
  }
  if (currentGroup !== null && currentGroup.length > 0) {
    groupedLines.push(currentGroup);
  }

  return groupedLines;
}

/**
 * Parses a `.tres` file: first block must be `gd_resource` with no property lines;
 * remaining blocks become {@link types.Resource} entries.
 */
export function parseResourceFile(filePath: string): types.ResourceFile {
  const fileContent = fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0);
  const groupedLines = groupLinesByHeader(fileContent);

  const resources: types.Resource[] = groupedLines.map((res) => {
    if (res.length === 0) {
      throw new Error("Empty resource.");
    }

    const header = parseResourceHeader(res[0]);
    const properties = res.slice(1).map((prop) => parseResourceProperty(prop));
    return { header, properties } as types.Resource;
  });
  if (resources[0].properties.length > 0) {
    throw new Error("Base resource has properties.");
  }

  const fileHeader = resources[0].header;
  const file = new types.ResourceFile(fileHeader, resources.slice(1));

  return file as types.ResourceFile;
}

/** Parses `[type name=value ...]` into a {@link types.ResourceHeader}. */
export function parseResourceHeader(line: string): types.ResourceHeader {
  if (!line.startsWith('[') || !line.endsWith(']')) {
    throw new Error(`Invalid resource header: "${line}"`);
  }
  
  const things = [...line.matchAll(/[^ \]\[]+/g)];
  if (!things || things.length === 0) {
    throw new Error("Empty resource header string.");
  }

  const type = things[0][0] as types.ResourceType;
  const modifiers = things.slice(1).map((modifier) => {
    const [name, value] = modifier[0].split('=');
    return { name, value: stripOuterQuotes(value) } as types.ResourceTypeModifier;
  });

  return new types.ResourceHeader(type, modifiers);
}

/** Parses `name = value` (single `=`); value is quote-stripped but otherwise raw text. */
export function parseResourceProperty(line: string): types.ResourceProperty {
  const property = /([^ =]+) = (.*)/g.exec(line);
  if (!property) {
    throw new Error(`Invalid resource property: "${line}"`);
  }

  const name = property[1] as string;
  const value = stripOuterQuotes(property[2] as string);

  return { name, value } as types.ResourceProperty;
}