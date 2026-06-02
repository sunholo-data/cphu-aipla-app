/** Single entry point for recharts imports.
 *
 *  Every chart component in this directory MUST import from here,
 *  never from "recharts" directly. This keeps the recharts code-split
 *  point in one place so:
 *
 *    1. Webpack/Turbopack tree-shake only what's actually used.
 *    2. Bundle analysis can confirm recharts only ships on teacher
 *       routes (not /lessons, /chat/*, /group).
 *    3. Future swap of viz library = one file to change.
 *
 *  Bundle discipline (sprint plan §Code preservation): direct
 *  `from "recharts"` outside this file is a sprint-plan violation.
 *  M1 verifies by manual grep; a lint rule may follow in v1.1.
 */

export {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";

export type {
  TooltipProps,
} from "recharts";
