export function contrastRatio(foreground: string, background: string): number {
  const fg = parseRgb(foreground);
  const bg = parseRgb(background);
  const lighter = Math.max(relativeLuminance(fg), relativeLuminance(bg));
  const darker = Math.min(relativeLuminance(fg), relativeLuminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

function parseRgb(color: string): [number, number, number] {
  if (color.startsWith('color(srgb')) {
    const channels = color
      .match(/-?\d+(\.\d+)?/g)
      ?.slice(0, 3)
      .map((channel) => Number(channel) * 255);
    if (
      channels?.length === 3 &&
      channels[0] !== undefined &&
      channels[1] !== undefined &&
      channels[2] !== undefined
    ) {
      return [channels[0], channels[1], channels[2]];
    }
  }

  const channels = color
    .match(/\d+(\.\d+)?/g)
    ?.slice(0, 3)
    .map(Number);
  if (
    channels?.length !== 3 ||
    channels[0] === undefined ||
    channels[1] === undefined ||
    channels[2] === undefined
  ) {
    throw new Error(`Expected an rgb() color, received ${color}`);
  }
  return [channels[0], channels[1], channels[2]];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const linear = (channel: number) => {
    const scaled = channel / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
