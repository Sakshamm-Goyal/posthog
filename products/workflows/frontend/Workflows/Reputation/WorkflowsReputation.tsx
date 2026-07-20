import { useValues } from 'kea'

import { LemonBanner, LemonTable, LemonTag, LemonTagType, Link, Tooltip } from '@posthog/lemon-ui'

import { TZLabel } from 'lib/components/TZLabel'
import { humanFriendlyNumber } from 'lib/utils/numbers'
import { urls } from 'scenes/urls'

import type {
    EmailReputationSnapshotApi,
    EmailReputationStateEnumApi,
    WorkflowEmailReputationSnapshotApi,
} from 'products/workflows/frontend/generated/api.schemas'

import { workflowsReputationLogic } from './workflowsReputationLogic'

// Descriptions must match the evaluator's default thresholds
// (nodejs/src/cdp/services/email-reputation/classifier.ts DEFAULT_THRESHOLDS).
const STATE_CONFIG: Record<EmailReputationStateEnumApi, { label: string; type: LemonTagType; tooltip: string }> = {
    healthy: {
        label: 'Healthy',
        type: 'success',
        tooltip: 'Bounce rate below 2% and spam complaint rate below 0.1%.',
    },
    warning: {
        label: 'Warning',
        type: 'warning',
        tooltip:
            'Bounce rate at or above 2%, or spam complaint rate at or above 0.1%. Review your recipient list before rates climb further.',
    },
    critical: {
        label: 'Critical',
        type: 'danger',
        tooltip:
            'Bounce rate at or above 5%, or spam complaint rate at or above 0.5%. Sending at these rates puts email deliverability at risk.',
    },
    insufficient_data: {
        label: 'Not enough data',
        type: 'muted',
        tooltip: 'Fewer than 100 emails in the evaluated window, which is too few to judge reliably.',
    },
}

// Must match the evaluator's default thresholds
// (nodejs/src/cdp/services/email-reputation/classifier.ts DEFAULT_THRESHOLDS).
const THRESHOLDS = {
    bounceWarning: 0.02,
    bounceCritical: 0.05,
    complaintWarning: 0.001,
    complaintCritical: 0.005,
}

/** Names the exact threshold the project crossed; complaint wins when both breach (mirrors the classifier). */
function breachDescription(reputation: EmailReputationSnapshotApi): string | null {
    if (reputation.state === 'critical') {
        return reputation.complaint_rate >= THRESHOLDS.complaintCritical
            ? `The spam complaint rate (${formatRate(reputation.complaint_rate)}) is at or above the ${formatRate(THRESHOLDS.complaintCritical)} critical threshold.`
            : `The bounce rate (${formatRate(reputation.bounce_rate)}) is at or above the ${formatRate(THRESHOLDS.bounceCritical)} critical threshold.`
    }
    if (reputation.state === 'warning') {
        return reputation.complaint_rate >= THRESHOLDS.complaintWarning
            ? `The spam complaint rate (${formatRate(reputation.complaint_rate)}) is at or above the ${formatRate(THRESHOLDS.complaintWarning)} warning threshold.`
            : `The bounce rate (${formatRate(reputation.bounce_rate)}) is at or above the ${formatRate(THRESHOLDS.bounceWarning)} warning threshold.`
    }
    return null
}

function StateTag({ state }: { state: EmailReputationStateEnumApi }): JSX.Element {
    const config = STATE_CONFIG[state] ?? STATE_CONFIG.insufficient_data
    return (
        <Tooltip title={config.tooltip}>
            <LemonTag type={config.type}>{config.label}</LemonTag>
        </Tooltip>
    )
}

function formatRate(rate: number): string {
    return `${(rate * 100).toFixed(2)}%`
}

function TeamReputationCard({ reputation }: { reputation: EmailReputationSnapshotApi }): JSX.Element {
    return (
        <div className="border rounded p-4 bg-surface-primary">
            <div className="flex items-center gap-2">
                <h3 className="mb-0">Project email reputation</h3>
                <StateTag state={reputation.state} />
            </div>
            <div className="flex flex-wrap gap-8 mt-3">
                <div>
                    <div className="text-secondary text-xs">Bounce rate</div>
                    <div className="text-lg font-semibold">{formatRate(reputation.bounce_rate)}</div>
                </div>
                <div>
                    <div className="text-secondary text-xs">Spam complaint rate</div>
                    <div className="text-lg font-semibold">{formatRate(reputation.complaint_rate)}</div>
                </div>
                <div>
                    <div className="text-secondary text-xs">Emails evaluated (recent volume)</div>
                    <div className="text-lg font-semibold">{humanFriendlyNumber(reputation.emails_sent)}</div>
                </div>
                <div>
                    <div className="text-secondary text-xs">Last evaluated</div>
                    <div className="text-lg font-semibold">
                        <TZLabel time={reputation.evaluated_at} />
                    </div>
                </div>
            </div>
        </div>
    )
}

export function WorkflowsReputation(): JSX.Element {
    const { teamReputation, workflowSnapshots, reputationResponseLoading } = useValues(workflowsReputationLogic)
    const breach = teamReputation ? breachDescription(teamReputation) : null

    return (
        <div className="space-y-4" data-attr="workflows-reputation">
            {teamReputation && breach && (
                <LemonBanner type={teamReputation.state === 'critical' ? 'error' : 'warning'}>
                    <b>This project's email reputation needs attention.</b> {breach} Scores cover your most recent
                    sending: at least the last 24 hours and at least the last 1,000 emails. Review your recipient list
                    to protect deliverability.
                </LemonBanner>
            )}
            {teamReputation ? (
                <TeamReputationCard reputation={teamReputation} />
            ) : (
                !reputationResponseLoading && (
                    <div className="border rounded p-4 text-secondary">
                        No reputation data yet. Reputation is calculated daily from email bounces and spam complaints
                        once your workflows start sending email.
                    </div>
                )
            )}
            <LemonTable
                dataSource={[...workflowSnapshots]}
                loading={reputationResponseLoading}
                rowKey={(snapshot) => snapshot.hog_flow_id}
                emptyState="No workflows have sent enough email to be evaluated yet."
                columns={[
                    {
                        title: 'Workflow',
                        key: 'workflow',
                        render: (_, snapshot: WorkflowEmailReputationSnapshotApi) => (
                            <Link to={urls.workflow(snapshot.hog_flow_id, 'workflow')} className="font-semibold">
                                {snapshot.hog_flow_name || snapshot.hog_flow_id}
                            </Link>
                        ),
                    },
                    {
                        title: 'State',
                        key: 'state',
                        render: (_, snapshot: WorkflowEmailReputationSnapshotApi) => (
                            <StateTag state={snapshot.state} />
                        ),
                    },
                    {
                        title: 'Bounce rate',
                        key: 'bounce_rate',
                        align: 'right',
                        render: (_, snapshot: WorkflowEmailReputationSnapshotApi) => formatRate(snapshot.bounce_rate),
                    },
                    {
                        title: 'Complaint rate',
                        key: 'complaint_rate',
                        align: 'right',
                        render: (_, snapshot: WorkflowEmailReputationSnapshotApi) =>
                            formatRate(snapshot.complaint_rate),
                    },
                    {
                        title: 'Emails sent',
                        key: 'emails_sent',
                        align: 'right',
                        render: (_, snapshot: WorkflowEmailReputationSnapshotApi) =>
                            humanFriendlyNumber(snapshot.emails_sent),
                    },
                    {
                        title: 'Evaluated',
                        key: 'evaluated_at',
                        render: (_, snapshot: WorkflowEmailReputationSnapshotApi) => (
                            <TZLabel time={snapshot.evaluated_at} />
                        ),
                    },
                ]}
            />
        </div>
    )
}
