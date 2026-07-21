from posthog.test.base import BaseTest
from unittest.mock import patch

from posthog.models.team import Team
from posthog.models.team.extensions import get_or_create_team_extension

from products.feature_flags.backend.models import TeamFeatureFlagsConfig

RELOAD_TEAM_ON_WORKERS = "products.feature_flags.backend.models.team_feature_flags_config.reload_team_on_workers"


class TestTeamFeatureFlagsConfig(BaseTest):
    def test_new_team_config_defaults_to_disabled(self):
        team = Team.objects.create(organization=self.organization, name="New Team")

        config = TeamFeatureFlagsConfig.objects.get(team=team)
        self.assertFalse(config.minimal_flag_called_events)

    def test_lazily_created_config_defaults_to_disabled(self):
        # A team without a row models a legacy team predating this extension.
        TeamFeatureFlagsConfig.objects.filter(team=self.team).delete()

        config = get_or_create_team_extension(self.team, TeamFeatureFlagsConfig)
        self.assertFalse(config.minimal_flag_called_events)

    def test_saving_an_update_reloads_workers_on_commit(self):
        # Node's TeamManager only picks up a DB change on its ~2 minute background refresh
        # unless this fires; covers every sanctioned writer (not just the staff API), since
        # it's a signal on the model rather than a call from one specific view.
        config = TeamFeatureFlagsConfig.objects.get(team=self.team)

        with patch(RELOAD_TEAM_ON_WORKERS) as mock_reload, self.captureOnCommitCallbacks(execute=True):
            config.minimal_flag_called_events = True
            config.save(update_fields=["minimal_flag_called_events"])

        mock_reload.assert_called_once_with(self.team.id)

    def test_creating_a_config_row_does_not_reload_workers(self):
        # A fresh row is always the same default (False) the Node cache already assumes when no
        # row exists, so publishing here would be a no-op reload on every single team creation.
        with patch(RELOAD_TEAM_ON_WORKERS) as mock_reload, self.captureOnCommitCallbacks(execute=True):
            Team.objects.create(organization=self.organization, name="Another new team")

        mock_reload.assert_not_called()
