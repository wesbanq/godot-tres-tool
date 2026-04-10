import fs from 'node:fs'
import { z } from 'zod'
import * as types from './tres-types'

/** Thrown when `.tres` parsing reports one or more issues. */
export class ParseAggregateError extends Error {
  readonly errors: string[]

  constructor(errors: string[]) {
    super(errors.join('\n\n'))
    this.name = 'ParseAggregateError'
    this.errors = errors
  }
}

/** Optional context for parse errors: 1-based line index and full source lines (index 0 = line 1). */
export const parseLineContextSchema = z.object({
  lineNo: z.number().int().positive(),
  allLines: z.array(z.string()),
})
export type ParseLineContext = z.infer<typeof parseLineContextSchema>

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

function throwZodParse(err: z.ZodError, ctx?: ParseLineContext): never {
  const msg = types.formatZodError(err)
  if (ctx !== undefined) {
    throw formatParseError(msg, ctx)
  }
  throw new Error(msg)
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

/**
 * Parses `.tres` text into a {@link types.ResourceFile} without document-level validation.
 * The first block must have no property lines (otherwise those lines would be dropped from the model).
 * Line/header/property syntax errors are collected and reported via {@link ParseAggregateError}.
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
      resources.push(new types.Resource(header, properties))
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
  return types.ResourceFile.fromParsedTres(fileHeader, inner)
}

/** Reads a `.tres` file and parses it with {@link parseResourceContent}. */
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

  const modifiers = things.slice(1).map((modifier) => {
    const modText = modifier[0]
    const eq = modText.indexOf('=')
    if (eq <= 0) {
      throwParse(`Invalid resource header modifier (expected name=value): "${modText}"`, context)
    }
    const name = modText.slice(0, eq)
    const value = stripOuterQuotes(modText.slice(eq + 1))
    return { name, value }
  })

  const rawHeader = { type: things[0][0], modifiers }
  const parsed = types.resourceHeaderJsonSchema.safeParse(rawHeader)
  if (!parsed.success) {
    throwZodParse(parsed.error, context)
  }

  return new types.ResourceHeader(
    parsed.data.type,
    parsed.data.modifiers.map((m) => new types.ResourceTypeModifier(m.name, m.value))
  )
}

/** Parses `name = value` (single `=`); value is quote-stripped but otherwise raw text. */
export function parseResourceProperty(line: string, context?: ParseLineContext): types.ResourceProperty {
  const property = /([^ =]+) = (.*)/g.exec(line)
  if (!property) {
    throwParse(`Invalid resource property: "${line}"`, context)
  }

  const name = property[1]
  const value = stripOuterQuotes(property[2])

  const parsed = types.resourcePropertyJsonSchema.safeParse({ name, value })
  if (!parsed.success) {
    throwZodParse(parsed.error, context)
  }

  return new types.ResourceProperty(parsed.data.name, parsed.data.value)
}
