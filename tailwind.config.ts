import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        coral: "#D96845",
        ink: "#29332F",
        cream: "#F7F7F2",
        sage: "#75896F",
      },
      fontFamily: { sans: ["Manrope", "Arial", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
