/** The part of bwip-js the decoders use to learn patterns and verify reads. */
export interface BwipRaw {
  raw(bcid: string, text: string, opts: string): readonly object[];
}

/** One row of bwip-js raw output: bar/space widths, bar heights and bottoms. */
export interface RawSymbol {
  sbs?: number[];
  bhs?: number[];
  bbs?: number[];
}

export interface ExtraResult {
  bcid: string;
  text: string;
}

export function tryRaw(bwip: BwipRaw, bcid: string, text: string, opts = ''): RawSymbol | null {
  try {
    return (bwip.raw(bcid, text, opts)[0] as RawSymbol | undefined) ?? null;
  } catch {
    return null;
  }
}
