import type { ReactNode } from "react";
import type {
  CasePriority,
  DefectPriority,
  DefectSeverity,
  DefectStatus,
  ExecutionStatus,
  FlakyVerdict,
  RequirementCriticality,
} from "@/lib/types";
import { titleCase } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

function toneFor(tone: Tone): string {
  return `badge--${tone}`;
}

const EXEC_TONE: Record<ExecutionStatus, Tone> = {
  untested: "neutral",
  passed: "success",
  failed: "danger",
  blocked: "warning",
  skipped: "neutral",
  retest: "info",
};

const SEV_TONE: Record<DefectSeverity, Tone> = {
  trivial: "neutral",
  minor: "info",
  major: "warning",
  critical: "danger",
  blocker: "danger",
};

const PRIO_TONE: Record<string, Tone> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  critical: "danger",
  urgent: "danger",
};

const DEFECT_STATUS_TONE: Record<DefectStatus, Tone> = {
  new: "accent",
  triaged: "info",
  in_progress: "warning",
  resolved: "success",
  verified: "success",
  closed: "neutral",
  reopened: "danger",
  wont_fix: "neutral",
  duplicate: "neutral",
};

const FLAKY_TONE: Record<FlakyVerdict, Tone> = {
  stable: "success",
  suspect: "warning",
  flaky: "danger",
};

const CRIT_TONE: Record<RequirementCriticality, Tone> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  critical: "danger",
};

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}

export function Badge({ tone = "neutral", children, title }: BadgeProps) {
  return (
    <span className={`badge ${toneFor(tone)}`} title={title}>
      {children}
    </span>
  );
}

export function ExecutionBadge({ status }: { status: ExecutionStatus }) {
  return <Badge tone={EXEC_TONE[status]}>{titleCase(status)}</Badge>;
}

export function SeverityBadge({ severity }: { severity: DefectSeverity }) {
  return <Badge tone={SEV_TONE[severity]}>{titleCase(severity)}</Badge>;
}

export function PriorityBadge({ priority }: { priority: DefectPriority | CasePriority }) {
  return <Badge tone={PRIO_TONE[priority] ?? "neutral"}>{titleCase(priority)}</Badge>;
}

export function DefectStatusBadge({ status }: { status: DefectStatus }) {
  return <Badge tone={DEFECT_STATUS_TONE[status]}>{titleCase(status)}</Badge>;
}

export function FlakyBadge({ verdict }: { verdict: FlakyVerdict }) {
  return <Badge tone={FLAKY_TONE[verdict]}>{titleCase(verdict)}</Badge>;
}

export function CriticalityBadge({
  criticality,
}: {
  criticality: RequirementCriticality;
}) {
  return <Badge tone={CRIT_TONE[criticality]}>{titleCase(criticality)}</Badge>;
}

export function AutomationBadge({
  status,
}: {
  status: "manual" | "automated" | "candidate";
}) {
  const tone: Tone =
    status === "automated" ? "success" : status === "candidate" ? "info" : "neutral";
  return <Badge tone={tone}>{titleCase(status)}</Badge>;
}
