import type { ColorPalette } from "../../hooks/use-theme.js";

export type PaletteOption = {
  id: ColorPalette;
  label: string;
  description: string;
  /** Representative swatch colors: [primary-dark, bg-dark, primary-light]. */
  swatches: readonly [string, string, string];
};

export const PALETTE_OPTIONS: readonly PaletteOption[] = [
  {
    id: "copper",
    label: "Copper",
    description: "Warm earthy tones.",
    swatches: ["oklch(60% 0.155 46)", "#141614", "oklch(47% 0.128 40)"],
  },
  {
    id: "ocean",
    label: "Ocean",
    description: "Cool blue depths.",
    swatches: ["oklch(60% 0.150 240)", "#121518", "oklch(47% 0.128 240)"],
  },
  {
    id: "ember",
    label: "Ember",
    description: "Fiery red-orange warmth.",
    swatches: ["oklch(60% 0.165 18)", "#171312", "oklch(47% 0.138 18)"],
  },
  {
    id: "sage",
    label: "Sage",
    description: "Calm natural greens.",
    swatches: ["oklch(60% 0.120 155)", "#121615", "oklch(47% 0.100 155)"],
  },
  {
    id: "neon",
    label: "Neon",
    description: "Vibrant electric hues.",
    swatches: ["oklch(65% 0.250 300)", "#141216", "oklch(50% 0.220 300)"],
  },
];
