import fs from 'node:fs'
import * as types from './tres-types'

/** Thrown when `.tres` parsing or document validation reports one or more issues. */
export class ParseAggregateError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join('\n\n'));
    this.name = 'ParseAggregateError';
    this.errors = errors;
  }
}

/** Optional context for parse errors: 1-based line index and full source lines (index 0 = line 1). */
export type ParseLineContext = {
  lineNo: number
  allLines: string[]
}

/** Default number of lines before/after the error line to show. */
const DEFAULT_CONTEXT_RADIUS = 2

function formatParseError(message: string, ctx: ParseLineContext, radius = DEFAULT_CONTEXT_RADIUS): Error {
  const { lineNo, allLines } = ctx
  const start = Math.max(1, lineNo - radius)
  const end = Math.min(allLines.length, lineNo + radius)
  const parts: string[] = [message, `Near line ${lineNo}:`]
  for (let n = start; n <= end; n++) {
    const marker = n === lineNo ? '>' : ' '
    const text = allLines[n - 1] ?? ''
    parts.push(`  ${marker} ${n} | ${text}`)
  }
  return new Error(parts.join('\n'))
}

function throwParse(message: string, ctx?: ParseLineContext): never {
  if (ctx !== undefined) {
    throw formatParseError(message, ctx)
  }
  throw new Error(message)
}

type LineRef = { text: string; lineNo: number }

/** Removes paired surrounding `"` repeatedly (Godot may wrap modifier values in quotes). */
function stripOuterQuotes(raw: string): string {
  let s = raw.trim()
  while (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    s = s.slice(1, -1)
  }
  return s
}

/** One group per `[...]` header line and its following non-empty lines until the next header. */
function groupLinesByHeader(lines: LineRef[]): LineRef[][] {
  const groupedLines: LineRef[][] = []
  let currentGroup: LineRef[] | null = null
  for (const line of lines) {
    if (line.text.startsWith('[')) {
      if (currentGroup !== null && currentGroup.length > 0) {
        groupedLines.push(currentGroup)
      }
      currentGroup = [line]
    } else if (line.text.trim().length > 0) {
      if (currentGroup === null) {
        continue
      }
      currentGroup.push(line)
    }
  }
  if (currentGroup !== null && currentGroup.length > 0) {
    groupedLines.push(currentGroup)
  }

  return groupedLines
}

function lineNoForResourceFileError(
  message: string,
  headerLineNos: number[],
  resources: types.Resource[]
): number {
  if (headerLineNos.length === 0) {
    return 1
  }
  if (message === 'Multiple gd_resource headers found in file.') {
    const idx = resources.findIndex((r, i) => i >= 2 && r.header.type === 'gd_resource')
    return idx >= 0 ? headerLineNos[idx] : headerLineNos[0]
  }
  return headerLineNos[0]
}

/**
 * Parses `.tres` text: first block must be `gd_resource` with no property lines;
 * remaining blocks become {@link types.Resource} entries.
 * Collects every line and document-level problem, then throws {@link ParseAggregateError} if any exist.
 */
export function parseResourceContent(source: string): types.ResourceFile {
  const allLines = source.split(/\r?\n/)
  const nonEmpty: LineRef[] = []
  for (let i = 0; i < allLines.length; i++) {
    const text = allLines[i]
    if (text.trim().length > 0) {
      nonEmpty.push({ text, lineNo: i + 1 })
    }
  }

  const groupedLines = groupLinesByHeader(nonEmpty)
  const errors: string[] = []

  if (groupedLines.length === 0) {
    errors.push(
      formatParseError(
        'No resource blocks found (expected a line starting with `[`, e.g. `[gd_resource ...]`).',
        { lineNo: 1, allLines: allLines.length > 0 ? allLines : [''] }
      ).message
    )
    throw new ParseAggregateError(errors)
  }

  const headerLineNos = groupedLines.map((g) => g[0].lineNo)
  const resources: types.Resource[] = []

  for (const res of groupedLines) {
    if (res.length === 0) {
      errors.push(
        formatParseError('Empty resource.', { lineNo: headerLineNos[0] ?? 1, allLines }).message
      )
      continue
    }

    const headerLine = res[0]
    let header: types.ResourceHeader | undefined
    try {
      header = parseResourceHeader(headerLine.text, {
        lineNo: headerLine.lineNo,
        allLines,
      })
    } catch (e) {
      errors.push((e as Error).message)
    }

    const properties: types.ResourceProperty[] = []
    for (const prop of res.slice(1)) {
      try {
        properties.push(
          parseResourceProperty(prop.text, { lineNo: prop.lineNo, allLines })
        )
      } catch (e) {
        errors.push((e as Error).message)
      }
    }

    if (header !== undefined) {
      resources.push({ header, properties } as types.Resource)
    }
  }

  if (errors.length > 0) {
    throw new ParseAggregateError(errors)
  }

  if (resources[0].properties.length > 0) {
    const firstProp = groupedLines[0][1]
    throw new ParseAggregateError([
      formatParseError('Base resource has properties.', {
        lineNo: firstProp.lineNo,
        allLines,
      }).message,
    ])
  }

  const fileHeader = resources[0].header
  const inner = resources.slice(1)
  const fileValMsgs = types.ResourceFile.collectValidationErrors(fileHeader, inner)
  if (fileValMsgs.length > 0) {
    const formatted = fileValMsgs.map((msg) =>
      formatParseError(msg, {
        lineNo: lineNoForResourceFileError(msg, headerLineNos, resources),
        allLines,
      }).message
    )
    throw new ParseAggregateError(formatted)
  }

  return new types.ResourceFile(fileHeader, inner) as types.ResourceFile
}

/**
 * Parses a `.tres` file: first block must be `gd_resource` with no property lines;
 * remaining blocks become {@link types.Resource} entries.
 */
export function parseResourceFile(filePath: string): types.ResourceFile {
  return parseResourceContent(fs.readFileSync(filePath, 'utf8'))
}

/** Parses `[type name=value ...]` into a {@link types.ResourceHeader}. */
export function parseResourceHeader(line: string, context?: ParseLineContext): types.ResourceHeader {
  if (!line.startsWith('[') || !line.endsWith(']')) {
    throwParse(`Invalid resource header: "${line}"`, context)
  }

  const things = [...line.matchAll(/[^ \]\[]+/g)]
  if (!things || things.length === 0) {
    throwParse('Empty resource header string.', context)
  }

  const type = things[0][0] as types.ResourceType
  const modifiers = things.slice(1).map((modifier) => {
    const [name, value] = modifier[0].split('=')
    return { name, value: stripOuterQuotes(value) } as types.ResourceTypeModifier
  })

  try {
    return new types.ResourceHeader(type, modifiers)
  } catch (e) {
    if (e instanceof Error && context !== undefined) {
      throw formatParseError(e.message, context)
    }
    throw e
  }
}

/** Parses `name = value` (single `=`); value is quote-stripped but otherwise raw text. */
export function parseResourceProperty(line: string, context?: ParseLineContext): types.ResourceProperty {
  const property = /([^ =]+) = (.*)/g.exec(line)
  if (!property) {
    throwParse(`Invalid resource property: "${line}"`, context)
  }

  const name = property[1] as string
  const value = stripOuterQuotes(property[2] as string)

  const prop = new types.ResourceProperty(name, value)
  try {
    prop.validate()
  } catch (e) {
    if (e instanceof Error && context !== undefined) {
      throw formatParseError(e.message, context)
    }
    throw e
  }
  return prop
}
