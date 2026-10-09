export type Archive = Map<string, Uint8Array>;

const COUNT_SIZE = 2;
const ENTRY_SIZE = 22;
const NAME_SIZE = 14;

function readName(bytes: Uint8Array, offset: number): string {
  const raw = bytes.subarray(offset, offset + NAME_SIZE);
  const end = raw.indexOf(0);
  return String.fromCharCode(...raw.subarray(0, end === -1 ? NAME_SIZE : end));
}

export function parseArchive(bytes: Uint8Array): Archive {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < COUNT_SIZE) {
    throw new Error('Archive is too short to hold a file count');
  }
  const count = view.getUint16(0, true);
  if (COUNT_SIZE + count * ENTRY_SIZE > bytes.length) {
    throw new Error(`Archive directory of ${count} files does not fit in ${bytes.length} bytes`);
  }

  const archive: Archive = new Map();
  for (let index = 0; index < count; index++) {
    const entry = COUNT_SIZE + index * ENTRY_SIZE;
    const name = readName(bytes, entry);
    const size = view.getUint32(entry + NAME_SIZE, true);
    // offsets are relative to the end of the file count
    const start = COUNT_SIZE + view.getUint32(entry + NAME_SIZE + 4, true);
    if (start + size > bytes.length) {
      throw new Error(`Archive entry ${name} points outside the archive`);
    }
    archive.set(name.toUpperCase(), bytes.subarray(start, start + size));
  }
  return archive;
}

export function hasFile(archive: Archive, name: string): boolean {
  return archive.has(name.toUpperCase());
}

export function getFile(archive: Archive, name: string): Uint8Array {
  const file = archive.get(name.toUpperCase());
  if (!file) {
    throw new Error(`File ${name} is not in the archive`);
  }
  return file;
}
