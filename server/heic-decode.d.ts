declare module "heic-decode" {
  type DecodedImage = {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  };

  export default function decode(input: {
    buffer: Buffer;
  }): Promise<DecodedImage>;
}
