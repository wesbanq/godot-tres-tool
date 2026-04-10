import { z } from 'zod'
import * as types from './tres-types'

function replaceInStringProperties(resources: types.Resource[], oldNeedle: string, newNeedle: string): void {
  for (const resource of resources) {
    for (const property of resource.properties) {
      const str = z.string().safeParse(property.value)
      if (str.success) {
        property.value = str.data.replace(oldNeedle, newNeedle)
      }
    }
  }
}

export function changeResPath(
  resourceFile: types.ResourceFile,
  oldPath: types.PropertyRes,
  newPath: types.PropertyRes
): types.ResourceFile {
  const from = types.propertyResSchema.parse(oldPath)
  const to = types.propertyResSchema.parse(newPath)
  for (const resource of resourceFile.resources) {
    for (const modifier of resource.header.modifiers) {
      if (types.propertyResSchema.safeParse(modifier.value).success) {
        if (modifier.value === from) {
          modifier.value = to
        }
      }
    }
    replaceInStringProperties([resource], from, to)
  }
  return resourceFile
}

export function changeId(
  resourceFile: types.ResourceFile,
  oldId: types.PropertyId,
  newId: types.PropertyId
): types.ResourceFile {
  const from = types.propertyIdSchema.parse(oldId)
  const to = types.propertyIdSchema.parse(newId)
  for (const resource of resourceFile.resources) {
    for (const modifier of resource.header.modifiers) {
      if (types.propertyIdSchema.safeParse(modifier.value).success) {
        if (modifier.value === from) {
          modifier.value = to
        }
      }
    }
    replaceInStringProperties([resource], from, to)
  }
  return resourceFile
}

export function changeUid(
  resourceFile: types.ResourceFile,
  oldUid: types.PropertyUid,
  newUid: types.PropertyUid
): types.ResourceFile {
  const from = types.propertyUidSchema.parse(oldUid)
  const to = types.propertyUidSchema.parse(newUid)
  for (const resource of resourceFile.resources) {
    for (const modifier of resource.header.modifiers) {
      if (types.propertyUidSchema.safeParse(modifier.value).success) {
        if (modifier.value === from) {
          modifier.value = to
        }
      }
    }
    replaceInStringProperties([resource], from, to)
  }
  return resourceFile
}
