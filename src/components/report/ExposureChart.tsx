import { Bar, BarChart, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { formatUsd } from "@/lib/format";

export interface ExposureDatum {
  type: string;
  label: string;
  amount: number;
}

/**
 * One horizontal bar for each finding type. The chart is decoration for sighted readers:
 * the same figures are in the table next to it, so it is hidden from assistive technology.
 */
export default function ExposureChart({ data }: { data: readonly ExposureDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={data.length * 40 + 12}>
      <BarChart
        data={[...data]}
        layout="vertical"
        margin={{ top: 4, right: 88, bottom: 4, left: 0 }}
        barCategoryGap="30%"
        accessibilityLayer={false}
      >
        <XAxis type="number" hide domain={[0, "dataMax"]} />
        <YAxis
          type="category"
          dataKey="label"
          width={205}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--muted)", fontSize: 12 }}
        />
        <Bar dataKey="amount" fill="var(--brand)" radius={[0, 5, 5, 0]} minPointSize={2} isAnimationActive={false}>
          <LabelList
            dataKey="amount"
            position="right"
            fill="var(--ink)"
            fontSize={12}
            formatter={(value: unknown) => formatUsd(Number(value))}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
