import { chart, colors } from "@/theme";
import { clamp } from "@/lib/utils";

// Lightweight dependency-free SVG charts driven by design tokens.

export function DonutChart({
  segments,
  size = 120,
  thickness = 16,
  label,
  sublabel,
}: {
  segments: Array<{ value: number; color: string; label: string }>;
  size?: number;
  thickness?: number;
  label?: string;
  sublabel?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Donut chart: ${segments
        .map((s) => `${s.label} ${s.value}`)
        .join(", ")}`}
    >
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={colors.border}
        strokeWidth={thickness}
      />
      {total > 0 &&
        segments.map((seg, i) => {
          const frac = seg.value / total;
          const len = frac * circ;
          const el = (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={thickness}
              strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          );
          offset += len;
          return el;
        })}
      {label ? (
        <>
          <text
            x={cx}
            y={cy - 2}
            textAnchor="middle"
            fill={colors.text}
            fontSize={size * 0.2}
            fontWeight={700}
          >
            {label}
          </text>
          {sublabel ? (
            <text
              x={cx}
              y={cy + size * 0.13}
              textAnchor="middle"
              fill={colors.textMuted}
              fontSize={size * 0.08}
            >
              {sublabel}
            </text>
          ) : null}
        </>
      ) : null}
    </svg>
  );
}

export function TrendChart({
  points,
  width = 400,
  height = 140,
}: {
  points: Array<{ label: string; value: number }>;
  width?: number;
  height?: number;
}) {
  const pad = { top: 12, right: 12, bottom: 24, left: 36 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const min = 0;
  const max = 100;

  const x = (i: number) =>
    points.length <= 1 ? pad.left + innerW / 2 : pad.left + (i / (points.length - 1)) * innerW;
  const y = (v: number) => pad.top + innerH - (clamp(v, min, max) / (max - min)) * innerH;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ height }}
      role="img"
      aria-label="Trend chart"
    >
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={y(v)}
            y2={y(v)}
            stroke={colors.border}
            strokeWidth={1}
          />
          <text
            x={pad.left - 6}
            y={y(v) + 3}
            textAnchor="end"
            fill={colors.textMuted}
            fontSize={10}
          >
            {v}
          </text>
        </g>
      ))}
      {points.length > 0 && (
        <>
          <path d={path} fill="none" stroke={chart.series[0]} strokeWidth={2} />
          {points.map((p, i) => (
            <circle key={i} cx={x(i)} cy={y(p.value)} r={2.5} fill={chart.series[0]} />
          ))}
        </>
      )}
      {points.map((p, i) => (
        <text
          key={i}
          x={x(i)}
          y={height - 6}
          textAnchor="middle"
          fill={colors.textMuted}
          fontSize={9}
        >
          {p.label}
        </text>
      ))}
    </svg>
  );
}

export function Sparkline({
  values,
  width = 120,
  height = 28,
  color = chart.series[0],
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length === 0) return <span className="text-muted">—</span>;
  const max = Math.max(...values, 1);
  const x = (i: number) => (values.length <= 1 ? width / 2 : (i / (values.length - 1)) * width);
  const y = (v: number) => height - 3 - (v / max) * (height - 6);
  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2} fill={color} />
    </svg>
  );
}

export function OutcomeDots({
  outcomes,
}: {
  outcomes: Array<{ status: string; label: string }>;
}) {
  const tone: Record<string, string> = {
    passed: chart.pass,
    failed: chart.fail,
    blocked: chart.blocked,
    skipped: chart.skipped,
    untested: chart.untested,
    retest: chart.retest,
  };
  return (
    <div className="flex gap-1 items-center" role="img" aria-label="Outcome timeline">
      {outcomes.map((o, i) => (
        <span
          key={i}
          className="tooltip"
          data-tip={`${o.label}: ${o.status}`}
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: tone[o.status] ?? chart.skipped,
            display: "inline-block",
          }}
        />
      ))}
    </div>
  );
}

export function BurnDownChart({
  points,
  width = 400,
  height = 140,
}: {
  points: Array<{ label: string; value: number }>;
  width?: number;
  height?: number;
}) {
  const pad = { top: 12, right: 12, bottom: 24, left: 36 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number) =>
    points.length <= 1 ? pad.left + innerW / 2 : pad.left + (i / (points.length - 1)) * innerW;
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ height }}
      role="img"
      aria-label="Burn-down chart"
    >
      {points.length > 0 && (
        <>
          <path d={path} fill="none" stroke={colors.warning} strokeWidth={2} />
          {points.map((p, i) => (
            <circle key={i} cx={x(i)} cy={y(p.value)} r={2.5} fill={colors.warning} />
          ))}
        </>
      )}
      {points.map((p, i) => (
        <text
          key={i}
          x={x(i)}
          y={height - 6}
          textAnchor="middle"
          fill={colors.textMuted}
          fontSize={9}
        >
          {p.label}
        </text>
      ))}
    </svg>
  );
}
