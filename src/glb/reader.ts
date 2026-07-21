import { Document, NodeIO } from '@gltf-transform/core';
import { info, debug } from '../util/log.js';

export async function readGlb(inputPath: string): Promise<Document> {
  info(`Reading input: ${inputPath}`);
  const io = new NodeIO();
  let doc: Document;
  try {
    doc = await io.read(inputPath);
  } catch (err) {
    throw new Error(`Failed to read ${inputPath}: ${(err as Error).message}`);
  }

  const root = doc.getRoot();
  debug(`Meshes: ${root.listMeshes().length}, Nodes: ${root.listNodes().length}, Accessors: ${root.listAccessors().length}`);
  // Suppress internal logging
  (doc as any).setLogger?.({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} });
  return doc;
}

export async function writeGlb(doc: Document, outputPath: string): Promise<void> {
  debug(`Writing GLB: ${outputPath}`);
  const io = new NodeIO();
  try {
    await io.write(outputPath, doc);
  } catch (err) {
    throw new Error(`Failed to write ${outputPath}: ${(err as Error).message}`);
  }
}
