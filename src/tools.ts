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
  oldPath: types.ResourceRes,
  newPath: types.ResourceRes
): types.ResourceFile {
  const from = types.resourceResSchema.parse(oldPath)
  const to = types.resourceResSchema.parse(newPath)
  for (const resource of resourceFile.resources) {
    for (const modifier of resource.header.modifiers) {
      if (types.isResourceRes(modifier.value)) {
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
  oldId: types.ResourceId,
  newId: types.ResourceId
): types.ResourceFile {
  const from = types.resourceIdSchema.parse(oldId)
  const to = types.resourceIdSchema.parse(newId)
  for (const resource of resourceFile.resources) {
    for (const modifier of resource.header.modifiers) {
      if (types.isResourceId(modifier.value)) {
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
  oldUid: types.ResourceUid,
  newUid: types.ResourceUid
): types.ResourceFile {
  const from = types.resourceUidSchema.parse(oldUid)
  const to = types.resourceUidSchema.parse(newUid)
  for (const resource of resourceFile.resources) {
    for (const modifier of resource.header.modifiers) {
      if (types.isResourceUid(modifier.value)) {
        if (modifier.value === from) {
          modifier.value = to
        }
      }
    }
    replaceInStringProperties([resource], from, to)
  }
  return resourceFile
}
