import * as types from './tres-types';

export function changeResPath(
  resourceFile: types.ResourceFile, 
  oldPath: types.ResourceRes, 
  newPath: types.ResourceRes
): types.ResourceFile {
  for (const resource of resourceFile.resources) {
    for (const modifier of resource.header.modifiers) {
      if (types.isResourceRes(modifier.value)) {
        if (modifier.value === oldPath) {
          modifier.value = newPath;
        }
      }
    }
    for (const property of resource.properties) {
      property.value = property.value.replace(oldPath, newPath);
    }
  }
  return resourceFile;
}