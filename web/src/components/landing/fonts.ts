import { Instrument_Serif, JetBrains_Mono, Manrope, Syne } from "next/font/google";

// Landing-page type: Syne for display, Instrument Serif italics for accents, Manrope for reading, JetBrains Mono for data.
const display = Syne({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--lx-display" });
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--lx-serif",
});
const body = Manrope({ subsets: ["latin"], variable: "--lx-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--lx-mono" });

export const landingFonts = [display.variable, serif.variable, body.variable, mono.variable].join(" ");
