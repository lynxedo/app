-- Lynxedo (Supabase project nhvwdulyzolevoeayjum "Lynxedo App") — Row-Level Security policies
-- READ-ONLY EXPORT for version control + recovery. Generated from pg_policies (public schema).
-- These are the app's authoritative access rules; previously they lived only in the cloud.
-- Do NOT hand-edit to change prod — change RLS in Supabase, then re-run the export (see db/README.md).
-- Exported via Supabase MCP execute_sql.

-- Enable RLS on every policied table --
ALTER TABLE public.announcement_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apns_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_item_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_item_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_ai_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_synx_bridges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_synx_user_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_routing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_log_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_log_read_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_log_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_log_skip_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_log_stop_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_log_stop_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_log_stop_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_log_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_log_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_log_update_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_log_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialer_ring_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialer_ring_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialer_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fcm_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_knowledge_doc_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_knowledge_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_web_search_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holiday_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_file_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_read_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_sms_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobber_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobber_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paid_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pesticide_line_item_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pesticide_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_location_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pto_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pto_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qbo_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_program_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responder_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responder_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_capacity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scoreboard_technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_punch_edit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_punches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.txt_broadcast_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.txt_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.txt_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.txt_conversation_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.txt_conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.txt_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.txt_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.txt_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.txt_phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.txt_scheduled_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.txt_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.txt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voicemails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zone_sizer_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY ann_reactions_delete
  ON public.announcement_reactions  AS PERMISSIVE  FOR DELETE  TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY ann_reactions_insert
  ON public.announcement_reactions  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY ann_reactions_select
  ON public.announcement_reactions  AS PERMISSIVE  FOR SELECT  TO public
  USING ((EXISTS ( SELECT 1
   FROM hub_announcements ha
  WHERE ((ha.id = announcement_reactions.announcement_id) AND (ha.company_id = get_my_company_id())))));

CREATE POLICY api_keys_insert
  ON public.api_keys  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK (((company_id = get_my_company_id()) AND (EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = ( SELECT auth.uid() AS uid)) AND (up.role = 'admin'::text))))));

CREATE POLICY api_keys_select
  ON public.api_keys  AS PERMISSIVE  FOR SELECT  TO public
  USING (((company_id = get_my_company_id()) AND (EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = ( SELECT auth.uid() AS uid)) AND (up.role = 'admin'::text))))));

CREATE POLICY api_keys_update
  ON public.api_keys  AS PERMISSIVE  FOR UPDATE  TO public
  USING (((company_id = get_my_company_id()) AND (EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = ( SELECT auth.uid() AS uid)) AND (up.role = 'admin'::text))))));

CREATE POLICY "Users can manage own APNs tokens"
  ON public.apns_tokens  AS PERMISSIVE  FOR ALL  TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY board_item_attachments_delete
  ON public.board_item_attachments  AS PERMISSIVE  FOR DELETE  TO public
  USING (((company_id = get_my_company_id()) AND ((uploaded_by = ( SELECT auth.uid() AS uid)) OR (( SELECT user_profiles.role
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid))) = 'admin'::text))));

CREATE POLICY board_item_attachments_insert
  ON public.board_item_attachments  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK ((company_id = get_my_company_id()));

CREATE POLICY board_item_attachments_select
  ON public.board_item_attachments  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY bic_delete
  ON public.board_item_comments  AS PERMISSIVE  FOR DELETE  TO public
  USING ((created_by = ( SELECT auth.uid() AS uid)));

CREATE POLICY bic_insert
  ON public.board_item_comments  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK (((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY bic_select
  ON public.board_item_comments  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY board_items_delete
  ON public.board_items  AS PERMISSIVE  FOR DELETE  TO public
  USING ((board_id IN ( SELECT boards.id
   FROM boards)));

CREATE POLICY board_items_insert
  ON public.board_items  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK (((board_id IN ( SELECT boards.id
   FROM boards)) AND (company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY board_items_select
  ON public.board_items  AS PERMISSIVE  FOR SELECT  TO public
  USING ((board_id IN ( SELECT boards.id
   FROM boards)));

CREATE POLICY board_items_update
  ON public.board_items  AS PERMISSIVE  FOR UPDATE  TO public
  USING ((board_id IN ( SELECT boards.id
   FROM boards)));

CREATE POLICY board_members_delete
  ON public.board_members  AS PERMISSIVE  FOR DELETE  TO public
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR (board_id IN ( SELECT boards.id
   FROM boards
  WHERE (boards.created_by = ( SELECT auth.uid() AS uid))))));

CREATE POLICY board_members_insert
  ON public.board_members  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY board_members_select
  ON public.board_members  AS PERMISSIVE  FOR SELECT  TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY boards_delete
  ON public.boards  AS PERMISSIVE  FOR DELETE  TO public
  USING ((created_by = ( SELECT auth.uid() AS uid)));

CREATE POLICY boards_insert
  ON public.boards  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK (((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY boards_select
  ON public.boards  AS PERMISSIVE  FOR SELECT  TO public
  USING (((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))) AND ((is_private = false) OR (created_by = ( SELECT auth.uid() AS uid)) OR (id IN ( SELECT board_members.board_id
   FROM board_members
  WHERE (board_members.user_id = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY boards_update
  ON public.boards  AS PERMISSIVE  FOR UPDATE  TO public
  USING (((created_by = ( SELECT auth.uid() AS uid)) OR (( SELECT auth.uid() AS uid) IN ( SELECT user_profiles.id
   FROM user_profiles
  WHERE ((user_profiles.role = 'admin'::text) AND (user_profiles.id = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY call_ai_results_select
  ON public.call_ai_results  AS PERMISSIVE  FOR SELECT  TO authenticated
  USING ((company_id = get_my_company_id()));

CREATE POLICY "users can read own company call_logs"
  ON public.call_logs  AS PERMISSIVE  FOR SELECT  TO authenticated
  USING ((company_id = get_my_company_id()));

CREATE POLICY calls_select_same_company
  ON public.calls  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY chat_synx_bridges_select_same_company
  ON public.chat_synx_bridges  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY chat_synx_user_links_select_same_company
  ON public.chat_synx_user_links  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY client_notes_admin
  ON public.client_notes  AS PERMISSIVE  FOR ALL  TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = auth.uid()) AND (up.role = 'admin'::text)))));

CREATE POLICY client_notes_select
  ON public.client_notes  AS PERMISSIVE  FOR SELECT  TO public
  USING (((company_id = get_my_company_id()) AND (deleted_at IS NULL)));

CREATE POLICY client_tags_admin
  ON public.client_tags  AS PERMISSIVE  FOR ALL  TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = auth.uid()) AND (up.role = 'admin'::text)))));

CREATE POLICY client_tags_select
  ON public.client_tags  AS PERMISSIVE  FOR SELECT  TO public
  USING ((EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = client_tags.client_id) AND (c.company_id = get_my_company_id())))));

CREATE POLICY clients_admin_all
  ON public.clients  AS PERMISSIVE  FOR ALL  TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = auth.uid()) AND (up.role = 'admin'::text)))));

CREATE POLICY clients_select
  ON public.clients  AS PERMISSIVE  FOR SELECT  TO public
  USING (((company_id = get_my_company_id()) AND (deleted_at IS NULL)));

CREATE POLICY "users can read own company"
  ON public.companies  AS PERMISSIVE  FOR SELECT  TO authenticated
  USING ((id = get_my_company_id()));

CREATE POLICY "admins manage routing settings"
  ON public.company_routing_settings  AS PERMISSIVE  FOR ALL  TO public
  USING (((( SELECT user_profiles.role
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid))) = 'admin'::text) AND (company_id = ( SELECT hub_users.company_id
   FROM hub_users
  WHERE (hub_users.id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK (((( SELECT user_profiles.role
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid))) = 'admin'::text) AND (company_id = ( SELECT hub_users.company_id
   FROM hub_users
  WHERE (hub_users.id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "company members read routing settings"
  ON public.company_routing_settings  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = ( SELECT hub_users.company_id
   FROM hub_users
  WHERE (hub_users.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY contact_tag_assignments_select_via_contact
  ON public.contact_tag_assignments  AS PERMISSIVE  FOR SELECT  TO public
  USING ((EXISTS ( SELECT 1
   FROM txt_contacts
  WHERE (txt_contacts.id = contact_tag_assignments.contact_id))));

CREATE POLICY contact_tags_select_company
  ON public.contact_tags  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY contacts_admin_all
  ON public.contacts  AS PERMISSIVE  FOR ALL  TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = auth.uid()) AND (up.role = 'admin'::text)))));

CREATE POLICY contacts_select
  ON public.contacts  AS PERMISSIVE  FOR SELECT  TO public
  USING (((company_id = get_my_company_id()) AND (deleted_at IS NULL)));

CREATE POLICY conversation_members_insert
  ON public.conversation_members  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = conversation_members.conversation_id) AND (c.company_id = get_my_company_id())))));

CREATE POLICY conversation_members_select
  ON public.conversation_members  AS PERMISSIVE  FOR SELECT  TO public
  USING (is_conversation_member(conversation_id));

CREATE POLICY conversation_members_update_self
  ON public.conversation_members  AS PERMISSIVE  FOR UPDATE  TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY conversations_insert
  ON public.conversations  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK ((company_id = get_my_company_id()));

CREATE POLICY conversations_select
  ON public.conversations  AS PERMISSIVE  FOR SELECT  TO public
  USING (((company_id = get_my_company_id()) AND (EXISTS ( SELECT 1
   FROM conversation_members cm
  WHERE ((cm.conversation_id = conversations.id) AND (cm.user_id = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY dl_entries_delete
  ON public.daily_log_entries  AS PERMISSIVE  FOR DELETE  TO public
  USING (((created_by = ( SELECT auth.uid() AS uid)) OR (company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text))))));

CREATE POLICY dl_entries_insert
  ON public.daily_log_entries  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY dl_entries_select
  ON public.daily_log_entries  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY dl_entries_update
  ON public.daily_log_entries  AS PERMISSIVE  FOR UPDATE  TO public
  USING (((created_by = ( SELECT auth.uid() AS uid)) OR (company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text))))));

CREATE POLICY "Users manage own daily log read receipts"
  ON public.daily_log_read_receipts  AS PERMISSIVE  FOR ALL  TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY daily_log_settings_select_company
  ON public.daily_log_settings  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY daily_log_skip_reasons_company_select
  ON public.daily_log_skip_reasons  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = ( SELECT up.company_id
   FROM user_profiles up
  WHERE (up.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY daily_log_stop_attachments_company_select
  ON public.daily_log_stop_attachments  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = ( SELECT up.company_id
   FROM user_profiles up
  WHERE (up.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY daily_log_stop_messages_company_select
  ON public.daily_log_stop_messages  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = ( SELECT up.company_id
   FROM user_profiles up
  WHERE (up.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY daily_log_stop_reports_company_select
  ON public.daily_log_stop_reports  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = ( SELECT up.company_id
   FROM user_profiles up
  WHERE (up.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY daily_log_stops_select
  ON public.daily_log_stops  AS PERMISSIVE  FOR SELECT  TO public
  USING ((EXISTS ( SELECT 1
   FROM daily_log_entries e
  WHERE ((e.id = daily_log_stops.entry_id) AND (e.company_id = get_my_company_id())))));

CREATE POLICY dl_subscribers_delete
  ON public.daily_log_subscribers  AS PERMISSIVE  FOR DELETE  TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY dl_subscribers_insert
  ON public.daily_log_subscribers  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY dl_subscribers_select
  ON public.daily_log_subscribers  AS PERMISSIVE  FOR SELECT  TO public
  USING ((entry_id IN ( SELECT daily_log_entries.id
   FROM daily_log_entries
  WHERE (daily_log_entries.company_id IN ( SELECT user_profiles.company_id
           FROM user_profiles
          WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY daily_log_update_reactions_delete
  ON public.daily_log_update_reactions  AS PERMISSIVE  FOR DELETE  TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY daily_log_update_reactions_insert
  ON public.daily_log_update_reactions  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM daily_log_updates u
  WHERE ((u.id = daily_log_update_reactions.update_id) AND (u.company_id = get_my_company_id()))))));

CREATE POLICY daily_log_update_reactions_select
  ON public.daily_log_update_reactions  AS PERMISSIVE  FOR SELECT  TO public
  USING ((EXISTS ( SELECT 1
   FROM daily_log_updates u
  WHERE ((u.id = daily_log_update_reactions.update_id) AND (u.company_id = get_my_company_id())))));

CREATE POLICY dl_updates_delete
  ON public.daily_log_updates  AS PERMISSIVE  FOR DELETE  TO public
  USING (((created_by = ( SELECT auth.uid() AS uid)) OR (company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text))))));

CREATE POLICY dl_updates_insert
  ON public.daily_log_updates  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY dl_updates_select
  ON public.daily_log_updates  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY dialer_ring_group_members_select_same_company
  ON public.dialer_ring_group_members  AS PERMISSIVE  FOR SELECT  TO public
  USING ((group_id IN ( SELECT dialer_ring_groups.id
   FROM dialer_ring_groups
  WHERE (dialer_ring_groups.company_id IN ( SELECT user_profiles.company_id
           FROM user_profiles
          WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY dialer_ring_groups_select_same_company
  ON public.dialer_ring_groups  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY dialer_settings_select_same_company
  ON public.dialer_settings  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "users can read own company employees"
  ON public.employees  AS PERMISSIVE  FOR SELECT  TO authenticated
  USING ((company_id = get_my_company_id()));

CREATE POLICY external_links_select
  ON public.external_links  AS PERMISSIVE  FOR SELECT  TO authenticated
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "Users manage own FCM tokens"
  ON public.fcm_tokens  AS PERMISSIVE  FOR ALL  TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY files_insert
  ON public.files  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK (((company_id = get_my_company_id()) AND (uploader_id = ( SELECT auth.uid() AS uid))));

CREATE POLICY files_select
  ON public.files  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY fleet_alert_events_select_company
  ON public.fleet_alert_events  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.can_access_fleet = true)))));

CREATE POLICY fleet_settings_select_company
  ON public.fleet_settings  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY form_submissions_company_isolation
  ON public.form_submissions  AS PERMISSIVE  FOR ALL  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY forms_company_isolation
  ON public.forms  AS PERMISSIVE  FOR ALL  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY guardian_audit_select
  ON public.guardian_audit  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY guardian_knowledge_doc_versions_select
  ON public.guardian_knowledge_doc_versions  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = ( SELECT hub_users.company_id
   FROM hub_users
  WHERE (hub_users.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY guardian_knowledge_docs_select
  ON public.guardian_knowledge_docs  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = ( SELECT hub_users.company_id
   FROM hub_users
  WHERE (hub_users.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY guardian_settings_select
  ON public.guardian_settings  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = ( SELECT hub_users.company_id
   FROM hub_users
  WHERE (hub_users.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY guardian_web_search_usage_no_user_access
  ON public.guardian_web_search_usage  AS RESTRICTIVE  FOR ALL  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY holiday_overrides_delete
  ON public.holiday_overrides  AS PERMISSIVE  FOR DELETE  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND ((user_profiles.role = 'admin'::text) OR (user_profiles.can_admin_timesheet = true))))));

CREATE POLICY holiday_overrides_insert
  ON public.holiday_overrides  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND ((user_profiles.role = 'admin'::text) OR (user_profiles.can_admin_timesheet = true))))));

CREATE POLICY holiday_overrides_select
  ON public.holiday_overrides  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY holiday_overrides_update
  ON public.holiday_overrides  AS PERMISSIVE  FOR UPDATE  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND ((user_profiles.role = 'admin'::text) OR (user_profiles.can_admin_timesheet = true))))));

CREATE POLICY hub_announcements_delete
  ON public.hub_announcements  AS PERMISSIVE  FOR DELETE  TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.company_id = hub_announcements.company_id) AND (user_profiles.role = 'admin'::text)))));

CREATE POLICY hub_announcements_insert
  ON public.hub_announcements  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.company_id = hub_announcements.company_id) AND (user_profiles.role = 'admin'::text)))));

CREATE POLICY hub_announcements_select
  ON public.hub_announcements  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY hub_announcements_update
  ON public.hub_announcements  AS PERMISSIVE  FOR UPDATE  TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = ( SELECT auth.uid() AS uid)) AND (up.company_id = hub_announcements.company_id) AND ((up.role = 'admin'::text) OR (up.id = hub_announcements.created_by) OR ((up.can_post_shout_outs = true) AND (hub_announcements.type = 'shout_out'::text)))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = ( SELECT auth.uid() AS uid)) AND (up.company_id = hub_announcements.company_id) AND ((up.role = 'admin'::text) OR (up.id = hub_announcements.created_by) OR ((up.can_post_shout_outs = true) AND (hub_announcements.type = 'shout_out'::text)))))));

CREATE POLICY hub_api_keys_delete_admin
  ON public.hub_api_keys  AS PERMISSIVE  FOR DELETE  TO public
  USING (((company_id = get_my_company_id()) AND (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text))))));

CREATE POLICY hub_api_keys_insert_admin
  ON public.hub_api_keys  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK (((company_id = get_my_company_id()) AND (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text))))));

CREATE POLICY hub_api_keys_select_admin
  ON public.hub_api_keys  AS PERMISSIVE  FOR SELECT  TO public
  USING (((company_id = get_my_company_id()) AND (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text))))));

CREATE POLICY hub_api_keys_update_admin
  ON public.hub_api_keys  AS PERMISSIVE  FOR UPDATE  TO public
  USING (((company_id = get_my_company_id()) AND (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text))))));

CREATE POLICY hub_automation_rules_delete
  ON public.hub_automation_rules  AS PERMISSIVE  FOR DELETE  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text)))));

CREATE POLICY hub_automation_rules_insert
  ON public.hub_automation_rules  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text)))));

CREATE POLICY hub_automation_rules_select
  ON public.hub_automation_rules  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY hub_automation_rules_update
  ON public.hub_automation_rules  AS PERMISSIVE  FOR UPDATE  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text)))));

CREATE POLICY hub_contacts_delete
  ON public.hub_contacts  AS PERMISSIVE  FOR DELETE  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY hub_contacts_insert
  ON public.hub_contacts  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK ((company_id = get_my_company_id()));

CREATE POLICY hub_contacts_select
  ON public.hub_contacts  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY hub_contacts_update
  ON public.hub_contacts  AS PERMISSIVE  FOR UPDATE  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY hub_file_tags_delete
  ON public.hub_file_tags  AS PERMISSIVE  FOR DELETE  TO public
  USING (((company_id = get_my_company_id()) AND (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text))))));

CREATE POLICY hub_file_tags_insert
  ON public.hub_file_tags  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK (((company_id = get_my_company_id()) AND (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text))))));

CREATE POLICY hub_file_tags_select
  ON public.hub_file_tags  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY hub_file_tags_update
  ON public.hub_file_tags  AS PERMISSIVE  FOR UPDATE  TO public
  USING (((company_id = get_my_company_id()) AND (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text))))));

CREATE POLICY hub_files_delete
  ON public.hub_files  AS PERMISSIVE  FOR DELETE  TO public
  USING (((company_id = get_my_company_id()) AND (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text))))));

CREATE POLICY hub_files_insert
  ON public.hub_files  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK (((company_id = get_my_company_id()) AND (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text))))));

CREATE POLICY hub_files_select
  ON public.hub_files  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY "Users manage own read receipts"
  ON public.hub_read_receipts  AS PERMISSIVE  FOR ALL  TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY hub_read_receipts_select_dm_members
  ON public.hub_read_receipts  AS PERMISSIVE  FOR SELECT  TO public
  USING (((conversation_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM conversation_members cm
  WHERE ((cm.conversation_id = hub_read_receipts.conversation_id) AND (cm.user_id = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY hub_settings_select
  ON public.hub_settings  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY hub_settings_write
  ON public.hub_settings  AS PERMISSIVE  FOR ALL  TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.company_id = hub_settings.company_id) AND (user_profiles.role = 'admin'::text)))));

CREATE POLICY hub_sms_messages_insert
  ON public.hub_sms_messages  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK ((company_id = get_my_company_id()));

CREATE POLICY hub_sms_messages_select
  ON public.hub_sms_messages  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY hub_sms_messages_update
  ON public.hub_sms_messages  AS PERMISSIVE  FOR UPDATE  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY hub_users_select
  ON public.hub_users  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY hub_users_update
  ON public.hub_users  AS PERMISSIVE  FOR UPDATE  TO public
  USING ((id = ( SELECT auth.uid() AS uid)));

CREATE POLICY inventory_locations_select_company
  ON public.inventory_locations  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY invoices_admin_all
  ON public.invoices  AS PERMISSIVE  FOR ALL  TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = auth.uid()) AND (up.role = 'admin'::text)))));

CREATE POLICY invoices_select
  ON public.invoices  AS PERMISSIVE  FOR SELECT  TO public
  USING (((company_id = get_my_company_id()) AND (deleted_at IS NULL)));

CREATE POLICY job_notes_admin
  ON public.job_notes  AS PERMISSIVE  FOR ALL  TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = auth.uid()) AND (up.role = 'admin'::text)))));

CREATE POLICY job_notes_select
  ON public.job_notes  AS PERMISSIVE  FOR SELECT  TO public
  USING (((company_id = get_my_company_id()) AND (deleted_at IS NULL)));

CREATE POLICY insert_own_tokens
  ON public.jobber_tokens  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY select_own_tokens
  ON public.jobber_tokens  AS PERMISSIVE  FOR SELECT  TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY update_own_tokens
  ON public.jobber_tokens  AS PERMISSIVE  FOR UPDATE  TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "company members can read jobber_users"
  ON public.jobber_users  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY jobs_admin_all
  ON public.jobs  AS PERMISSIVE  FOR ALL  TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = auth.uid()) AND (up.role = 'admin'::text)))));

CREATE POLICY jobs_select
  ON public.jobs  AS PERMISSIVE  FOR SELECT  TO public
  USING (((company_id = get_my_company_id()) AND (deleted_at IS NULL)));

CREATE POLICY lead_notes_company_isolation
  ON public.lead_notes  AS PERMISSIVE  FOR ALL  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY leads_company_isolation
  ON public.leads  AS PERMISSIVE  FOR ALL  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY line_items_admin_all
  ON public.line_items  AS PERMISSIVE  FOR ALL  TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = auth.uid()) AND (up.role = 'admin'::text)))));

CREATE POLICY line_items_select
  ON public.line_items  AS PERMISSIVE  FOR SELECT  TO public
  USING (((company_id = get_my_company_id()) AND (deleted_at IS NULL)));

CREATE POLICY messages_insert
  ON public.messages  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK (((company_id = get_my_company_id()) AND (sender_id = ( SELECT auth.uid() AS uid))));

CREATE POLICY messages_select
  ON public.messages  AS PERMISSIVE  FOR SELECT  TO public
  USING (((company_id = get_my_company_id()) AND (deleted_at IS NULL) AND (((room_id IS NOT NULL) AND can_access_room(room_id)) OR ((conversation_id IS NOT NULL) AND is_conversation_member(conversation_id)))));

CREATE POLICY messages_update
  ON public.messages  AS PERMISSIVE  FOR UPDATE  TO public
  USING (((company_id = get_my_company_id()) AND ((sender_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = ( SELECT auth.uid() AS uid)) AND (up.role = 'admin'::text)))))));

CREATE POLICY notification_prefs_all
  ON public.notification_prefs  AS PERMISSIVE  FOR ALL  TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY paid_holidays_delete
  ON public.paid_holidays  AS PERMISSIVE  FOR DELETE  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND ((user_profiles.role = 'admin'::text) OR (user_profiles.can_admin_timesheet = true))))));

CREATE POLICY paid_holidays_insert
  ON public.paid_holidays  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND ((user_profiles.role = 'admin'::text) OR (user_profiles.can_admin_timesheet = true))))));

CREATE POLICY paid_holidays_select
  ON public.paid_holidays  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY paid_holidays_update
  ON public.paid_holidays  AS PERMISSIVE  FOR UPDATE  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND ((user_profiles.role = 'admin'::text) OR (user_profiles.can_admin_timesheet = true))))));

CREATE POLICY pesticide_mappings_select_company
  ON public.pesticide_line_item_mappings  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY pesticide_records_select_company
  ON public.pesticide_records  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY product_categories_select_company
  ON public.product_categories  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY product_location_inventory_select_company
  ON public.product_location_inventory  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY product_variants_select_company
  ON public.product_variants  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY products_select_company
  ON public.products  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY properties_admin_all
  ON public.properties  AS PERMISSIVE  FOR ALL  TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = auth.uid()) AND (up.role = 'admin'::text)))));

CREATE POLICY properties_select
  ON public.properties  AS PERMISSIVE  FOR SELECT  TO public
  USING (((company_id = get_my_company_id()) AND (deleted_at IS NULL)));

CREATE POLICY pto_policies_delete
  ON public.pto_policies  AS PERMISSIVE  FOR DELETE  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND ((user_profiles.role = 'admin'::text) OR (user_profiles.can_admin_timesheet = true))))));

CREATE POLICY pto_policies_insert
  ON public.pto_policies  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND ((user_profiles.role = 'admin'::text) OR (user_profiles.can_admin_timesheet = true))))));

CREATE POLICY pto_policies_select_admin
  ON public.pto_policies  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND ((user_profiles.role = 'admin'::text) OR (user_profiles.can_admin_timesheet = true))))));

CREATE POLICY pto_policies_update
  ON public.pto_policies  AS PERMISSIVE  FOR UPDATE  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND ((user_profiles.role = 'admin'::text) OR (user_profiles.can_admin_timesheet = true))))));

CREATE POLICY pto_requests_insert_own
  ON public.pto_requests  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK (((employee_id IN ( SELECT employees.id
   FROM employees
  WHERE (employees.user_id = ( SELECT auth.uid() AS uid)))) AND (company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY pto_requests_select
  ON public.pto_requests  AS PERMISSIVE  FOR SELECT  TO public
  USING (((employee_id IN ( SELECT employees.id
   FROM employees
  WHERE (employees.user_id = ( SELECT auth.uid() AS uid)))) OR (company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND ((user_profiles.role = 'admin'::text) OR (user_profiles.can_admin_timesheet = true)))))));

CREATE POLICY pto_requests_update_admin
  ON public.pto_requests  AS PERMISSIVE  FOR UPDATE  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND ((user_profiles.role = 'admin'::text) OR (user_profiles.can_admin_timesheet = true))))));

CREATE POLICY push_subscriptions_own
  ON public.push_subscriptions  AS PERMISSIVE  FOR ALL  TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY qbo_tokens_no_user_access
  ON public.qbo_tokens  AS RESTRICTIVE  FOR ALL  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY reactions_delete
  ON public.reactions  AS PERMISSIVE  FOR DELETE  TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY reactions_insert
  ON public.reactions  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = reactions.message_id) AND (m.company_id = get_my_company_id()))))));

CREATE POLICY reactions_select
  ON public.reactions  AS PERMISSIVE  FOR SELECT  TO public
  USING ((EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = reactions.message_id) AND (m.company_id = get_my_company_id())))));

CREATE POLICY recurring_program_definitions_select
  ON public.recurring_program_definitions  AS PERMISSIVE  FOR SELECT  TO authenticated
  USING (true);

CREATE POLICY recurring_services_company_isolation
  ON public.recurring_services  AS PERMISSIVE  FOR ALL  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY "users can read own company responder_calls"
  ON public.responder_calls  AS PERMISSIVE  FOR SELECT  TO authenticated
  USING ((company_id = get_my_company_id()));

CREATE POLICY "users can read own company responder_settings"
  ON public.responder_settings  AS PERMISSIVE  FOR SELECT  TO authenticated
  USING ((company_id = get_my_company_id()));

CREATE POLICY "users can update own company responder_settings"
  ON public.responder_settings  AS PERMISSIVE  FOR UPDATE  TO authenticated
  USING ((company_id = get_my_company_id()))
  WITH CHECK ((company_id = get_my_company_id()));

CREATE POLICY room_members_delete
  ON public.room_members  AS PERMISSIVE  FOR DELETE  TO public
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = ( SELECT auth.uid() AS uid)) AND (up.role = 'admin'::text) AND (up.company_id = get_my_company_id()))))));

CREATE POLICY room_members_insert
  ON public.room_members  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM rooms r
  WHERE ((r.id = room_members.room_id) AND (r.company_id = get_my_company_id())))));

CREATE POLICY room_members_select
  ON public.room_members  AS PERMISSIVE  FOR SELECT  TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY rooms_insert
  ON public.rooms  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK ((company_id = get_my_company_id()));

CREATE POLICY rooms_select
  ON public.rooms  AS PERMISSIVE  FOR SELECT  TO public
  USING (((company_id = get_my_company_id()) AND ((NOT is_private) OR is_room_member(id))));

CREATE POLICY rooms_update
  ON public.rooms  AS PERMISSIVE  FOR UPDATE  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY route_batches_select_company
  ON public.route_batches  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY route_capacity_company_isolation
  ON public.route_capacity  AS PERMISSIVE  FOR ALL  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY route_definitions_select
  ON public.route_definitions  AS PERMISSIVE  FOR SELECT  TO authenticated
  USING (true);

CREATE POLICY scheduled_messages_delete
  ON public.scheduled_messages  AS PERMISSIVE  FOR DELETE  TO public
  USING ((sender_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY scheduled_messages_insert
  ON public.scheduled_messages  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK (((sender_id = ( SELECT auth.uid() AS uid)) AND (company_id = get_my_company_id())));

CREATE POLICY scheduled_messages_select
  ON public.scheduled_messages  AS PERMISSIVE  FOR SELECT  TO public
  USING ((sender_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY scoreboard_technicians_select
  ON public.scoreboard_technicians  AS PERMISSIVE  FOR SELECT  TO authenticated
  USING ((company_id = ( SELECT up.company_id
   FROM user_profiles up
  WHERE (up.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY service_definitions_select
  ON public.service_definitions  AS PERMISSIVE  FOR SELECT  TO authenticated
  USING (true);

CREATE POLICY company_admin_write_social_accounts
  ON public.social_accounts  AS PERMISSIVE  FOR ALL  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND ((user_profiles.role = 'admin'::text) OR (user_profiles.can_admin_marketing = true))))));

CREATE POLICY company_read_social_accounts
  ON public.social_accounts  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY company_marketing_write_social_posts
  ON public.social_posts  AS PERMISSIVE  FOR ALL  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND ((user_profiles.role = 'admin'::text) OR (user_profiles.can_admin_marketing = true) OR (user_profiles.can_access_marketing = true))))));

CREATE POLICY company_read_social_posts
  ON public.social_posts  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY sync_log_admin_all
  ON public.sync_log  AS PERMISSIVE  FOR ALL  TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = ( SELECT auth.uid() AS uid)) AND (up.role = 'admin'::text)))));

CREATE POLICY tags_admin
  ON public.tags  AS PERMISSIVE  FOR ALL  TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = auth.uid()) AND (up.role = 'admin'::text)))));

CREATE POLICY tags_select
  ON public.tags  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY "admins write own company entries"
  ON public.time_entries  AS PERMISSIVE  FOR ALL  TO authenticated
  USING (((company_id = get_my_company_id()) AND (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text))))));

CREATE POLICY "employees read own company entries"
  ON public.time_entries  AS PERMISSIVE  FOR SELECT  TO authenticated
  USING (((company_id = get_my_company_id()) AND ((employee_id IN ( SELECT employees.id
   FROM employees
  WHERE (employees.user_id = ( SELECT auth.uid() AS uid)))) OR (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text)))))));

CREATE POLICY time_punch_edit_requests_all
  ON public.time_punch_edit_requests  AS PERMISSIVE  FOR ALL  TO public
  USING (((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND ((user_profiles.role = 'admin'::text) OR (user_profiles.can_admin_timesheet = true))))) OR (employee_id IN ( SELECT employees.id
   FROM employees
  WHERE (employees.user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "admins update own company punches"
  ON public.time_punches  AS PERMISSIVE  FOR UPDATE  TO authenticated
  USING (((company_id = get_my_company_id()) AND (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text))))));

CREATE POLICY "employees insert own company punches"
  ON public.time_punches  AS PERMISSIVE  FOR INSERT  TO authenticated
  WITH CHECK (((company_id = get_my_company_id()) AND ((employee_id IN ( SELECT employees.id
   FROM employees
  WHERE (employees.user_id = ( SELECT auth.uid() AS uid)))) OR (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text)))))));

CREATE POLICY "employees read own company punches"
  ON public.time_punches  AS PERMISSIVE  FOR SELECT  TO authenticated
  USING (((company_id = get_my_company_id()) AND ((employee_id IN ( SELECT employees.id
   FROM employees
  WHERE (employees.user_id = ( SELECT auth.uid() AS uid)))) OR (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text)))))));

CREATE POLICY "admins can write own company timesheet_settings"
  ON public.timesheet_settings  AS PERMISSIVE  FOR UPDATE  TO authenticated
  USING (((company_id = get_my_company_id()) AND (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = ( SELECT auth.uid() AS uid)) AND (user_profiles.role = 'admin'::text))))))
  WITH CHECK ((company_id = get_my_company_id()));

CREATE POLICY "users can read own company timesheet_settings"
  ON public.timesheet_settings  AS PERMISSIVE  FOR SELECT  TO authenticated
  USING ((company_id = get_my_company_id()));

CREATE POLICY tracker_settings_company_isolation
  ON public.tracker_settings  AS PERMISSIVE  FOR ALL  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY txt_broadcast_recipients_select_company
  ON public.txt_broadcast_recipients  AS PERMISSIVE  FOR SELECT  TO public
  USING ((broadcast_id IN ( SELECT txt_broadcasts.id
   FROM txt_broadcasts
  WHERE (txt_broadcasts.company_id IN ( SELECT user_profiles.company_id
           FROM user_profiles
          WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY txt_broadcasts_select_company
  ON public.txt_broadcasts  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY txt_contacts_select_company
  ON public.txt_contacts  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY txt_conversation_contacts_select_company
  ON public.txt_conversation_contacts  AS PERMISSIVE  FOR SELECT  TO public
  USING ((conversation_id IN ( SELECT txt_conversations.id
   FROM txt_conversations
  WHERE (txt_conversations.company_id IN ( SELECT user_profiles.company_id
           FROM user_profiles
          WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY txt_conversation_members_select_company
  ON public.txt_conversation_members  AS PERMISSIVE  FOR SELECT  TO public
  USING ((conversation_id IN ( SELECT txt_conversations.id
   FROM txt_conversations
  WHERE (txt_conversations.company_id IN ( SELECT user_profiles.company_id
           FROM user_profiles
          WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY txt_conversations_select_company
  ON public.txt_conversations  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY txt_messages_select_company
  ON public.txt_messages  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY txt_notes_select_company
  ON public.txt_notes  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY txt_phone_numbers_select
  ON public.txt_phone_numbers  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY txt_scheduled_select
  ON public.txt_scheduled_messages  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY txt_settings_select
  ON public.txt_settings  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id = get_my_company_id()));

CREATE POLICY txt_templates_select
  ON public.txt_templates  AS PERMISSIVE  FOR SELECT  TO public
  USING ((((scope = 'org'::text) AND (company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid))))) OR ((scope = 'personal'::text) AND (owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "Users can read own profile"
  ON public.user_profiles  AS PERMISSIVE  FOR SELECT  TO public
  USING ((( SELECT auth.uid() AS uid) = id));

CREATE POLICY "Users can update own profile"
  ON public.user_profiles  AS PERMISSIVE  FOR UPDATE  TO public
  USING ((( SELECT auth.uid() AS uid) = id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = id));

CREATE POLICY "delete own settings"
  ON public.user_settings  AS PERMISSIVE  FOR DELETE  TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "insert own settings"
  ON public.user_settings  AS PERMISSIVE  FOR INSERT  TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "select own settings"
  ON public.user_settings  AS PERMISSIVE  FOR SELECT  TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "update own settings"
  ON public.user_settings  AS PERMISSIVE  FOR UPDATE  TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY visits_admin_all
  ON public.visits  AS PERMISSIVE  FOR ALL  TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = auth.uid()) AND (up.role = 'admin'::text)))));

CREATE POLICY visits_select
  ON public.visits  AS PERMISSIVE  FOR SELECT  TO public
  USING (((company_id = get_my_company_id()) AND (deleted_at IS NULL)));

CREATE POLICY voicemails_select_company
  ON public.voicemails  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY zone_sizer_settings_select_same_company
  ON public.zone_sizer_settings  AS PERMISSIVE  FOR SELECT  TO public
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = ( SELECT auth.uid() AS uid)))));
