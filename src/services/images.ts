import * as ImageManipulator from 'expo-image-manipulator';
import { b64ToBytes } from '../engine/base64';
import { deleteTemp } from './files';

/** Zet elke afbeelding (ook HEIC) om naar een verkleinde JPEG, lokaal op het toestel. */
export async function normalizeImage(uri: string, opts: { maxWidth?: number; quality?: number } = {}): Promise<{ bytes: Uint8Array; b64: string; width: number; height: number }> {
  const ctx = ImageManipulator.ImageManipulator.manipulate(uri);
  const first = await ctx.renderAsync();
  const resized = first.width > (opts.maxWidth ?? 1600) ? await ImageManipulator.ImageManipulator.manipulate(uri).resize({ width: opts.maxWidth ?? 1600 }).renderAsync() : first;
  const res = await resized.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: opts.quality ?? 0.8, base64: true });
  deleteTemp(res.uri); // het door de manipulator gemaakte tussenbestand
  return { bytes: b64ToBytes(res.base64 ?? ''), b64: res.base64 ?? '', width: res.width, height: res.height };
}

/** Draait een JPEG (base64) kwartslagen, lokaal. */
export async function rotateJpeg(b64: string, degrees: number): Promise<{ b64: string; width: number; height: number }> {
  const img = await ImageManipulator.ImageManipulator.manipulate(`data:image/jpeg;base64,${b64}`).rotate(degrees).renderAsync();
  const res = await img.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.9, base64: true });
  deleteTemp(res.uri);
  return { b64: res.base64 ?? '', width: res.width, height: res.height };
}
