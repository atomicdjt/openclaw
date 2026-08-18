#!/usr/bin/env bash
set -euo pipefail

RED_TESTS=(
  src/agents/tools/skill-workshop-tool-presentation.routing-boundary.test.ts
  src/gateway/server-methods/skills-workspace-handler.routing-boundary.test.ts
  packages/gateway-protocol/src/schema/agents-models-skills-routing-boundary.test.ts
)

set +e
node scripts/run-vitest.mjs "${RED_TESTS[@]}" > /tmp/125570-red.log 2>&1
red_status=$?
set -e
cat /tmp/125570-red.log
if [[ "$red_status" -eq 0 ]]; then
  echo "Expected P1 regressions to fail before the repair, but they passed." >&2
  exit 1
fi
echo "RED_PROOF=observed"

python3 - <<'PY'
from pathlib import Path

schema = Path("packages/gateway-protocol/src/schema/agents-models-skills.ts")
text = schema.read_text()
field = "  routingDescription: Type.Optional(Type.String()),\n"
if field not in text:
    raise SystemExit("routingDescription public schema field not found")
schema.write_text(text.replace(field, "", 1))

old_protocol_test = Path(
    "packages/gateway-protocol/src/schema/agents-models-skills-routing-description.test.ts"
)
if old_protocol_test.exists():
    old_protocol_test.unlink()

handler = Path("src/gateway/server-methods/skills-workspace-handler.ts")
text = handler.read_text()
anchor = 'export const SKILL_PROPOSAL_RESPONSE_HANDLED = Symbol("skill proposal response handled");\n'
helper = '''export const SKILL_PROPOSAL_RESPONSE_HANDLED = Symbol("skill proposal response handled");\n\nconst SKILL_PROPOSAL_RECORD_SCHEMA = "openclaw.skill-workshop.proposal.v1";\n\nfunction isSkillProposalRecord(value: unknown): value is Record<string, unknown> {\n  return (\n    value !== null &&\n    typeof value === "object" &&\n    !Array.isArray(value) &&\n    (value as Record<string, unknown>).schema === SKILL_PROPOSAL_RECORD_SCHEMA\n  );\n}\n\nfunction projectSkillProposalRecord(record: Record<string, unknown>): Record<string, unknown> {\n  const projected = { ...record };\n  delete projected.routingDescription;\n  return projected;\n}\n\nexport function projectSkillProposalGatewayResult<T>(result: T): T {\n  if (isSkillProposalRecord(result)) {\n    return projectSkillProposalRecord(result) as T;\n  }\n  if (result === null || typeof result !== "object" || Array.isArray(result)) {\n    return result;\n  }\n  const object = result as Record<string, unknown>;\n  if (!isSkillProposalRecord(object.record)) {\n    return result;\n  }\n  return { ...object, record: projectSkillProposalRecord(object.record) } as T;\n}\n'''
if "projectSkillProposalGatewayResult" not in text:
    if anchor not in text:
        raise SystemExit("Gateway projection anchor not found")
    text = text.replace(anchor, helper, 1)
respond = "      params.respond(true, result, undefined);\n"
projected_respond = "      params.respond(true, projectSkillProposalGatewayResult(result), undefined);\n"
if projected_respond not in text:
    if respond not in text:
        raise SystemExit("Gateway response anchor not found")
    text = text.replace(respond, projected_respond, 1)
handler.write_text(text)

presentation = Path("src/agents/tools/skill-workshop-tool-presentation.ts")
text = presentation.read_text()
constants_anchor = '''const EVALUATION_TRUNCATION_MARKER =\n  "\\n[truncated: evaluator details exceed the model projection limit]";\n'''
constants = '''const EVALUATION_TRUNCATION_MARKER =\n  "\\n[truncated: evaluator details exceed the model projection limit]";\nconst SKILL_PROPOSAL_INSPECT_MAX_CHARS = 20_000;\nconst INSPECT_TRUNCATION_MARKER =\n  "\\n[truncated: proposal inspect exceeds the model projection limit]";\n'''
if "SKILL_PROPOSAL_INSPECT_MAX_CHARS" not in text:
    if constants_anchor not in text:
        raise SystemExit("Inspect projection constants anchor not found")
    text = text.replace(constants_anchor, constants, 1)
old_return = '''  return [\n    `Proposal: ${proposal.record.id}`,\n    `Status: ${proposal.record.status}`,\n    `Kind: ${proposal.record.kind}`,\n    `Skill: ${proposal.record.target.skillKey}`,\n    `Version: ${proposal.record.proposedVersion}`,\n    `Scan: ${proposal.record.scan.state}`,\n    ...evaluationLines,\n    "",\n    proposal.content,\n    ...supportFiles,\n  ].join("\\n");\n'''
new_return = '''  const text = [\n    `Proposal: ${proposal.record.id}`,\n    `Status: ${proposal.record.status}`,\n    `Kind: ${proposal.record.kind}`,\n    `Skill: ${proposal.record.target.skillKey}`,\n    `Version: ${proposal.record.proposedVersion}`,\n    `Scan: ${proposal.record.scan.state}`,\n    ...evaluationLines,\n    "",\n    proposal.content,\n    ...supportFiles,\n  ].join("\\n");\n  return text.length > SKILL_PROPOSAL_INSPECT_MAX_CHARS\n    ? `${truncateUtf16Safe(\n        text,\n        SKILL_PROPOSAL_INSPECT_MAX_CHARS - INSPECT_TRUNCATION_MARKER.length,\n      )}${INSPECT_TRUNCATION_MARKER}`\n    : text;\n'''
if new_return not in text:
    if old_return not in text:
        raise SystemExit("Inspect return anchor not found")
    text = text.replace(old_return, new_return, 1)
presentation.write_text(text)
PY

pnpm exec oxfmt --write --threads=1 \
  src/agents/tools/skill-workshop-tool-presentation.ts \
  src/agents/tools/skill-workshop-tool-presentation.routing-boundary.test.ts \
  src/gateway/server-methods/skills-workspace-handler.ts \
  src/gateway/server-methods/skills-workspace-handler.routing-boundary.test.ts \
  packages/gateway-protocol/src/schema/agents-models-skills.ts \
  packages/gateway-protocol/src/schema/agents-models-skills-routing-boundary.test.ts \
  src/commands/doctor-skill-workshop-routing-provenance.test.ts \
  src/commands/doctor-skill-workshop-sqlite.ts

node scripts/run-vitest.mjs \
  src/agents/tools/skill-workshop-tool-presentation.routing-boundary.test.ts \
  src/gateway/server-methods/skills-workspace-handler.routing-boundary.test.ts \
  packages/gateway-protocol/src/schema/agents-models-skills-routing-boundary.test.ts \
  packages/gateway-protocol/src/schema/agents-models-skills.test.ts \
  src/gateway/server-methods/skills.proposals.test.ts \
  src/skills/workshop/service-description-boundary.test.ts \
  src/commands/doctor-skill-workshop-routing-provenance.test.ts \
  src/commands/doctor-skill-workshop-sqlite.test.ts

echo "GREEN_FOCUSED=passed"

pnpm protocol:check
pnpm deadcode:dependencies
pnpm tsgo:prod
pnpm tsgo:test:root
pnpm exec oxlint \
  src/agents/tools/skill-workshop-tool-presentation.ts \
  src/agents/tools/skill-workshop-tool-presentation.routing-boundary.test.ts \
  src/gateway/server-methods/skills-workspace-handler.ts \
  src/gateway/server-methods/skills-workspace-handler.routing-boundary.test.ts \
  packages/gateway-protocol/src/schema/agents-models-skills.ts \
  packages/gateway-protocol/src/schema/agents-models-skills-routing-boundary.test.ts \
  src/commands/doctor-skill-workshop-routing-provenance.test.ts \
  src/commands/doctor-skill-workshop-sqlite.ts \
  src/skills/workshop/apply-transition.ts \
  src/skills/workshop/proposal-draft.ts \
  src/skills/workshop/routing-description-provenance.ts \
  src/skills/workshop/service-description-boundary.test.ts \
  src/skills/workshop/service-propose.ts \
  src/skills/workshop/service.ts \
  src/skills/workshop/store-record.ts \
  src/skills/workshop/store-sqlite-record.ts \
  src/skills/workshop/types.ts
pnpm format:check
git diff --check

echo "STATIC_VERIFICATION=passed"

rm -f scripts/tmp-125570-p1-runner.sh

git checkout -B tmp/125570-p1-green
git config user.name "David Turner"
git config user.email "davidelsey9513@gmail.com"
git add -A
git commit -m "fix(skills): bound workshop routing projections"
git push --force origin HEAD:tmp/125570-p1-green

echo "GREEN_BRANCH_PUSHED=$(git rev-parse HEAD)"
