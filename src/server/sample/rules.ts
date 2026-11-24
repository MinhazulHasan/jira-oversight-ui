import { CHECKS_BY_NAME, type Rules } from "@/lib/api/schemas";

import { openByRule } from "./aggregates";
import { HOURS_PER_POINT, PROCESS_STAGES, PROCESS_VERSION, RULES_VERSION, missingFor } from "./catalogue";
import { memo, meta, type Dataset } from "./dataset";

/** The rule catalogue as the board runs it, with what each can measure and has */
export function rulesView(dataset: Dataset): Rules {
  return memo(dataset, "rules", () => {
    const open = openByRule(dataset);
    return {
      meta: meta(dataset),
      rules: dataset.rules.map((rule) => {
        const missing = missingFor(rule.catalogue);
        return {
          rule_id: rule.def.id,
          title: rule.def.title,
          description: rule.def.description,
          kind: rule.def.kind,
          severity: rule.def.severity,
          version: rule.custom ? rule.version : RULES_VERSION,
          threshold: rule.def.threshold,
          needs: rule.def.needs,
          measurable: missing.length === 0,
          missing_evidence: missing,
          open: open.get(rule.def.id) ?? 0,
          escalates_to: rule.def.escalatesTo,
          enabled: rule.enabled,
          customised: rule.customised,
          custom: rule.custom !== null,
          check_label: CHECKS_BY_NAME.get(rule.def.check)?.label ?? null,
        };
      }),
      process: {
        version: PROCESS_VERSION,
        project: dataset.board.key,
        stages: PROCESS_STAGES.map((stage) => ({
          stage: stage.stage,
          label: stage.label,
          mapped_statuses: [...stage.mappedStatuses],
          evidence: stage.evidence,
          measurable: stage.evidence !== "none",
          note: stage.note,
        })),
        estimate: { basis: "points", field: "story_points", hours_per_point: HOURS_PER_POINT },
      },
    };
  });
}
