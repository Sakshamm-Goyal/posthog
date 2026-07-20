import uuid

import pytest
from posthog.test.base import APIBaseTest

from rest_framework import status

from posthog.constants import AvailableFeature
from posthog.models.organization import OrganizationMembership
from posthog.models.user import User
from posthog.rbac.user_access_control import UserAccessControl

from products.warehouse_sources.backend.facade.models import ExternalDataSchema, ExternalDataSource

try:
    from ee.models.rbac.access_control import AccessControl
except ImportError:
    pass


@pytest.mark.ee
class TestExternalDataSchemaAccessControl(APIBaseTest):
    def setUp(self):
        super().setUp()

        self.organization.available_product_features = [
            {"key": AvailableFeature.ACCESS_CONTROL, "name": AvailableFeature.ACCESS_CONTROL},
        ]
        self.organization.save()

        # self.user modifies access controls in these tests, so make it an org admin.
        self.organization_membership.level = OrganizationMembership.Level.ADMIN
        self.organization_membership.save()

        self.editor_user = User.objects.create_and_join(self.organization, "editor@posthog.com", "testtest")
        self.source = ExternalDataSource.objects.create(
            team_id=self.team.pk,
            source_id=str(uuid.uuid4()),
            connection_id=str(uuid.uuid4()),
            destination_id=str(uuid.uuid4()),
            source_type="Stripe",
            created_by=self.user,
            prefix="test",
            job_inputs={"auth_method": {"selection": "api_key", "stripe_secret_key": "sk_test_123"}},
        )
        self.schema = ExternalDataSchema.objects.create(
            name="Customers", team_id=self.team.pk, source_id=self.source.id, table=None
        )

    def _grant_source_access(self, user, access_level):
        membership = OrganizationMembership.objects.get(user=user, organization=self.organization)
        return AccessControl.objects.create(
            team=self.team,
            resource="external_data_source",
            resource_id=None,
            access_level=access_level,
            organization_member=membership,
        )

    def test_per_table_lock_stores_schema_row_and_blocks_sync_for_source_editor(self):
        # Editor on the parent source can normally sync any of its tables.
        self._grant_source_access(self.editor_user, "editor")
        self.assertEqual(UserAccessControl(self.editor_user, self.team).get_user_access_level(self.schema), "editor")

        # An admin locks this one table to view-only via the per-table endpoint.
        editor_membership = OrganizationMembership.objects.get(user=self.editor_user, organization=self.organization)
        put = self.client.put(
            f"/api/environments/{self.team.pk}/external_data_schemas/{self.schema.id}/access_controls",
            {"organization_member": str(editor_membership.id), "access_level": "viewer"},
        )
        self.assertEqual(put.status_code, status.HTTP_200_OK, put.json())

        # The control is stored against the schema (not the parent source) — the whole feature
        # rests on this resource, since object-level enforcement reads external_data_schema rows.
        self.assertTrue(
            AccessControl.objects.filter(
                team=self.team,
                resource="external_data_schema",
                resource_id=str(self.schema.id),
                organization_member=editor_membership,
                access_level="viewer",
            ).exists()
        )
        self.assertFalse(
            AccessControl.objects.filter(
                team=self.team, resource="external_data_source", resource_id=str(self.schema.id)
            ).exists()
        )

        # The lock demotes the editor to viewer on this table only, so syncing it is now forbidden.
        self.assertEqual(UserAccessControl(self.editor_user, self.team).get_user_access_level(self.schema), "viewer")
        self.client.force_login(self.editor_user)
        reload = self.client.post(f"/api/environments/{self.team.pk}/external_data_schemas/{self.schema.id}/reload/")
        self.assertEqual(reload.status_code, status.HTTP_403_FORBIDDEN)
