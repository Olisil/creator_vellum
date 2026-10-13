declare module "imagetracerjs" {
  const ImageTracer: {
    imagedataToSVG(img: { width: number; height: number; data: Uint8ClampedArray }, options: Record<string, unknown>): string;
  };
  export default ImageTracer;
}
