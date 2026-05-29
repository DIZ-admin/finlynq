/**
 * FinlynqLogo — brand mark for React Native.
 *
 * Port of the web `src/components/FinlynqLogo.tsx` to `react-native-svg`
 * (the web one uses raw `<svg>`/`<path>` DOM elements that don't render under
 * React Native). Same geometry: a rounded square frame with an ascending
 * bar-chart path and an accent dot at the peak, in Finlynq amber by default.
 */
import Svg, { Rect, Path, Circle } from "react-native-svg";

export function FinlynqLogo({
  size = 32,
  color = "#f5a623",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22" fill="none">
      <Rect x={1} y={1} width={20} height={20} rx={2} fill="none" stroke={color} strokeWidth={1.5} />
      <Path
        d="M5 16 L5 9 L10 13 L10 6 L17 11"
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="miter"
        strokeLinecap="square"
      />
      <Circle cx={17} cy={11} r={1.6} fill={color} />
    </Svg>
  );
}
