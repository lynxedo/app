// Database types — generated from the live Supabase schema (audit #36).
// Source of truth for table/column shapes so a renamed/removed column fails at
// BUILD time instead of silently at runtime. Pairs with db/schema.sql (#13/#46).
//
// Regenerate with the Supabase types generator (project nhvwdulyzolevoeayjum).
// Adopt gradually: type a client with createClient<Database>() / SupabaseClient<Database>
// in a file, fix what it surfaces, repeat. Global wiring of the generic into the
// shared client factories is a separate, verified change (it type-checks every
// existing query at once) — do NOT flip it here.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      announcement_reactions: {
        Row: {
          announcement_id: string
          created_at: string
          emoji: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          created_at?: string
          emoji: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          created_at?: string
          emoji?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_reactions_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "hub_announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          last_used: string | null
          name: string
          revoked_at: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          last_used?: string | null
          name: string
          revoked_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          last_used?: string | null
          name?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      apns_tokens: {
        Row: {
          company_id: string
          device_token: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          device_token: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          device_token?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      board_item_assignees: {
        Row: {
          board_item_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          board_item_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          board_item_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_item_assignees_board_item_id_fkey"
            columns: ["board_item_id"]
            isOneToOne: false
            referencedRelation: "board_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_item_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_item_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      board_item_attachments: {
        Row: {
          board_item_id: string
          company_id: string
          created_at: string
          filename: string
          height_px: number | null
          id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          uploaded_by: string
          width_px: number | null
        }
        Insert: {
          board_item_id: string
          company_id: string
          created_at?: string
          filename: string
          height_px?: number | null
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_path: string
          uploaded_by: string
          width_px?: number | null
        }
        Update: {
          board_item_id?: string
          company_id?: string
          created_at?: string
          filename?: string
          height_px?: number | null
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string
          width_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "board_item_attachments_board_item_id_fkey"
            columns: ["board_item_id"]
            isOneToOne: false
            referencedRelation: "board_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_item_attachments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_item_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_item_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      board_item_comments: {
        Row: {
          board_item_id: string
          company_id: string
          content: string
          created_at: string
          created_by: string
          id: string
        }
        Insert: {
          board_item_id: string
          company_id: string
          content: string
          created_at?: string
          created_by: string
          id?: string
        }
        Update: {
          board_item_id?: string
          company_id?: string
          content?: string
          created_at?: string
          created_by?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_item_comments_board_item_id_fkey"
            columns: ["board_item_id"]
            isOneToOne: false
            referencedRelation: "board_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_item_comments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_item_comments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_item_comments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      board_items: {
        Row: {
          assignee_id: string | null
          board_id: string
          company_id: string
          content: string
          created_at: string
          created_by: string
          done: boolean
          done_at: string | null
          due_date: string | null
          due_time: string | null
          forwarded_from_message_id: string | null
          id: string
          overdue_notified_at: string | null
          priority: string
          recurrence: string
        }
        Insert: {
          assignee_id?: string | null
          board_id: string
          company_id: string
          content: string
          created_at?: string
          created_by: string
          done?: boolean
          done_at?: string | null
          due_date?: string | null
          due_time?: string | null
          forwarded_from_message_id?: string | null
          id?: string
          overdue_notified_at?: string | null
          priority?: string
          recurrence?: string
        }
        Update: {
          assignee_id?: string | null
          board_id?: string
          company_id?: string
          content?: string
          created_at?: string
          created_by?: string
          done?: boolean
          done_at?: string | null
          due_date?: string | null
          due_time?: string | null
          forwarded_from_message_id?: string | null
          id?: string
          overdue_notified_at?: string | null
          priority?: string
          recurrence?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_items_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_items_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_items_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_items_forwarded_from_message_id_fkey"
            columns: ["forwarded_from_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      board_members: {
        Row: {
          board_id: string
          id: string
          user_id: string
        }
        Insert: {
          board_id: string
          id?: string
          user_id: string
        }
        Update: {
          board_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_members_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      boards: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          id: string
          is_personal: boolean
          is_private: boolean
          name: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by: string
          id?: string
          is_personal?: boolean
          is_private?: boolean
          name: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          is_personal?: boolean
          is_private?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "boards_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boards_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boards_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      call_ai_results: {
        Row: {
          action_items: Json | null
          call_id: string
          call_type: string | null
          company_id: string
          created_at: string
          engine: string
          error_message: string | null
          id: string
          intents: Json | null
          latency_ms: number | null
          sentiment: string | null
          sentiment_json: Json | null
          summary: string | null
          topics: Json | null
          transcript_json: Json | null
          transcript_text: string | null
        }
        Insert: {
          action_items?: Json | null
          call_id: string
          call_type?: string | null
          company_id: string
          created_at?: string
          engine: string
          error_message?: string | null
          id?: string
          intents?: Json | null
          latency_ms?: number | null
          sentiment?: string | null
          sentiment_json?: Json | null
          summary?: string | null
          topics?: Json | null
          transcript_json?: Json | null
          transcript_text?: string | null
        }
        Update: {
          action_items?: Json | null
          call_id?: string
          call_type?: string | null
          company_id?: string
          created_at?: string
          engine?: string
          error_message?: string | null
          id?: string
          intents?: Json | null
          latency_ms?: number | null
          sentiment?: string | null
          sentiment_json?: Json | null
          summary?: string | null
          topics?: Json | null
          transcript_json?: Json | null
          transcript_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_ai_results_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      call_logs: {
        Row: {
          action_items: string[] | null
          avg_confidence: number | null
          call_datetime: string
          call_subject: string | null
          call_type: string | null
          coaching_json: Json | null
          company_id: string
          created_at: string | null
          customer_name: string | null
          customer_summary: string | null
          date: string
          direction: string
          duration_seconds: number | null
          filename: string
          headline: string | null
          hub_posted_at: string | null
          id: string
          must_listen: boolean | null
          must_listen_reason: string | null
          never_dos: string[] | null
          overall_grade: string | null
          phone: string
          recording_id: string
          red_flags: string[] | null
          rep_name: string | null
          sentiment: string | null
          sentiment_json: Json | null
          top_improvements: string[] | null
          top_wins: string[] | null
          transcript_speakers: Json | null
          transcript_text: string | null
        }
        Insert: {
          action_items?: string[] | null
          avg_confidence?: number | null
          call_datetime: string
          call_subject?: string | null
          call_type?: string | null
          coaching_json?: Json | null
          company_id?: string
          created_at?: string | null
          customer_name?: string | null
          customer_summary?: string | null
          date: string
          direction: string
          duration_seconds?: number | null
          filename: string
          headline?: string | null
          hub_posted_at?: string | null
          id?: string
          must_listen?: boolean | null
          must_listen_reason?: string | null
          never_dos?: string[] | null
          overall_grade?: string | null
          phone: string
          recording_id: string
          red_flags?: string[] | null
          rep_name?: string | null
          sentiment?: string | null
          sentiment_json?: Json | null
          top_improvements?: string[] | null
          top_wins?: string[] | null
          transcript_speakers?: Json | null
          transcript_text?: string | null
        }
        Update: {
          action_items?: string[] | null
          avg_confidence?: number | null
          call_datetime?: string
          call_subject?: string | null
          call_type?: string | null
          coaching_json?: Json | null
          company_id?: string
          created_at?: string | null
          customer_name?: string | null
          customer_summary?: string | null
          date?: string
          direction?: string
          duration_seconds?: number | null
          filename?: string
          headline?: string | null
          hub_posted_at?: string | null
          id?: string
          must_listen?: boolean | null
          must_listen_reason?: string | null
          never_dos?: string[] | null
          overall_grade?: string | null
          phone?: string
          recording_id?: string
          red_flags?: string[] | null
          rep_name?: string | null
          sentiment?: string | null
          sentiment_json?: Json | null
          top_improvements?: string[] | null
          top_wins?: string[] | null
          transcript_speakers?: Json | null
          transcript_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          action_items: Json | null
          agent_notes: string | null
          ai_summary: string | null
          answered_at: string | null
          call_type: string | null
          coaching_grade: string | null
          coaching_headline: string | null
          coaching_improvements: Json | null
          coaching_json: Json | null
          coaching_must_listen: boolean | null
          coaching_must_listen_reason: string | null
          coaching_never_dos: Json | null
          coaching_red_flags: Json | null
          coaching_wins: Json | null
          company_id: string
          conference_agent_sid: string | null
          conference_customer_sid: string | null
          conference_name: string | null
          conference_sid: string | null
          conference_transfer_sid: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          direction: string
          disposition: string | null
          disposition_at: string | null
          duration_seconds: number | null
          ended_at: string | null
          error_message: string | null
          from_number: string
          handled_by: string | null
          id: string
          initiated_by: string | null
          intents: Json | null
          parent_call_sid: string | null
          recording_duration_seconds: number | null
          recording_paused: boolean
          recording_storage_path: string | null
          recording_url: string | null
          responder_mode: string | null
          responder_text_status: string | null
          ring_pending: Json | null
          sentiment: string | null
          status: string
          to_number: string
          topics: Json | null
          transcript: string | null
          transcript_json: Json | null
          transcription_status: string
          twilio_call_sid: string | null
        }
        Insert: {
          action_items?: Json | null
          agent_notes?: string | null
          ai_summary?: string | null
          answered_at?: string | null
          call_type?: string | null
          coaching_grade?: string | null
          coaching_headline?: string | null
          coaching_improvements?: Json | null
          coaching_json?: Json | null
          coaching_must_listen?: boolean | null
          coaching_must_listen_reason?: string | null
          coaching_never_dos?: Json | null
          coaching_red_flags?: Json | null
          coaching_wins?: Json | null
          company_id: string
          conference_agent_sid?: string | null
          conference_customer_sid?: string | null
          conference_name?: string | null
          conference_sid?: string | null
          conference_transfer_sid?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          direction: string
          disposition?: string | null
          disposition_at?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          error_message?: string | null
          from_number: string
          handled_by?: string | null
          id?: string
          initiated_by?: string | null
          intents?: Json | null
          parent_call_sid?: string | null
          recording_duration_seconds?: number | null
          recording_paused?: boolean
          recording_storage_path?: string | null
          recording_url?: string | null
          responder_mode?: string | null
          responder_text_status?: string | null
          ring_pending?: Json | null
          sentiment?: string | null
          status?: string
          to_number: string
          topics?: Json | null
          transcript?: string | null
          transcript_json?: Json | null
          transcription_status?: string
          twilio_call_sid?: string | null
        }
        Update: {
          action_items?: Json | null
          agent_notes?: string | null
          ai_summary?: string | null
          answered_at?: string | null
          call_type?: string | null
          coaching_grade?: string | null
          coaching_headline?: string | null
          coaching_improvements?: Json | null
          coaching_json?: Json | null
          coaching_must_listen?: boolean | null
          coaching_must_listen_reason?: string | null
          coaching_never_dos?: Json | null
          coaching_red_flags?: Json | null
          coaching_wins?: Json | null
          company_id?: string
          conference_agent_sid?: string | null
          conference_customer_sid?: string | null
          conference_name?: string | null
          conference_sid?: string | null
          conference_transfer_sid?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          direction?: string
          disposition?: string | null
          disposition_at?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          error_message?: string | null
          from_number?: string
          handled_by?: string | null
          id?: string
          initiated_by?: string | null
          intents?: Json | null
          parent_call_sid?: string | null
          recording_duration_seconds?: number | null
          recording_paused?: boolean
          recording_storage_path?: string | null
          recording_url?: string | null
          responder_mode?: string | null
          responder_text_status?: string | null
          ring_pending?: Json | null
          sentiment?: string | null
          status?: string
          to_number?: string
          topics?: Json | null
          transcript?: string | null
          transcript_json?: Json | null
          transcription_status?: string
          twilio_call_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calls_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "txt_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "txt_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_synx_bridges: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          hub_room_id: string
          id: string
          slack_channel_id: string
        }
        Insert: {
          active?: boolean
          company_id: string
          created_at?: string
          hub_room_id: string
          id?: string
          slack_channel_id: string
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          hub_room_id?: string
          id?: string
          slack_channel_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_synx_bridges_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_synx_bridges_hub_room_id_fkey"
            columns: ["hub_room_id"]
            isOneToOne: true
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_synx_user_links: {
        Row: {
          avatar_url: string | null
          company_id: string
          created_at: string
          display_name: string | null
          hub_user_id: string
          slack_user_id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          company_id: string
          created_at?: string
          display_name?: string | null
          hub_user_id: string
          slack_user_id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          company_id?: string
          created_at?: string
          display_name?: string | null
          hub_user_id?: string
          slack_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_synx_user_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_synx_user_links_hub_user_id_fkey"
            columns: ["hub_user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_synx_user_links_hub_user_id_fkey"
            columns: ["hub_user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      client_notes: {
        Row: {
          author_external_id: string | null
          body: string | null
          client_id: string
          company_id: string
          created_at: string
          deleted_at: string | null
          external_created_at: string | null
          external_id: string | null
          id: string
          last_synced_at: string | null
          pinned: boolean
          source: string
        }
        Insert: {
          author_external_id?: string | null
          body?: string | null
          client_id: string
          company_id: string
          created_at?: string
          deleted_at?: string | null
          external_created_at?: string | null
          external_id?: string | null
          id?: string
          last_synced_at?: string | null
          pinned?: boolean
          source?: string
        }
        Update: {
          author_external_id?: string | null
          body?: string | null
          client_id?: string
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          external_created_at?: string | null
          external_id?: string | null
          id?: string
          last_synced_at?: string | null
          pinned?: boolean
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      client_tags: {
        Row: {
          client_id: string
          created_at: string
          tag_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          tag_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_tags_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          balance: number | null
          cancellation_reason: string | null
          company_id: string
          company_name: string | null
          created_at: string
          custom_fields: Json | null
          customer_since: string | null
          deleted_at: string | null
          email: string | null
          external_created_at: string | null
          external_id: string | null
          first_name: string | null
          id: string
          is_archived: boolean
          is_company: boolean
          is_lead: boolean
          jobber_web_uri: string | null
          last_name: string | null
          last_synced_at: string | null
          lead_source: string | null
          name: string | null
          phone: string | null
          phone_digits: string | null
          sales_person: string | null
          source: string
          updated_at: string
        }
        Insert: {
          balance?: number | null
          cancellation_reason?: string | null
          company_id: string
          company_name?: string | null
          created_at?: string
          custom_fields?: Json | null
          customer_since?: string | null
          deleted_at?: string | null
          email?: string | null
          external_created_at?: string | null
          external_id?: string | null
          first_name?: string | null
          id?: string
          is_archived?: boolean
          is_company?: boolean
          is_lead?: boolean
          jobber_web_uri?: string | null
          last_name?: string | null
          last_synced_at?: string | null
          lead_source?: string | null
          name?: string | null
          phone?: string | null
          phone_digits?: string | null
          sales_person?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          balance?: number | null
          cancellation_reason?: string | null
          company_id?: string
          company_name?: string | null
          created_at?: string
          custom_fields?: Json | null
          customer_since?: string | null
          deleted_at?: string | null
          email?: string | null
          external_created_at?: string | null
          external_id?: string | null
          first_name?: string | null
          id?: string
          is_archived?: boolean
          is_company?: boolean
          is_lead?: boolean
          jobber_web_uri?: string | null
          last_name?: string | null
          last_synced_at?: string | null
          lead_source?: string | null
          name?: string | null
          phone?: string | null
          phone_digits?: string | null
          sales_person?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          google_domain: string | null
          id: string
          is_active: boolean
          name: string
          plan_tier: string
          subdomain_slug: string | null
        }
        Insert: {
          created_at?: string
          google_domain?: string | null
          id?: string
          is_active?: boolean
          name: string
          plan_tier?: string
          subdomain_slug?: string | null
        }
        Update: {
          created_at?: string
          google_domain?: string | null
          id?: string
          is_active?: boolean
          name?: string
          plan_tier?: string
          subdomain_slug?: string | null
        }
        Relationships: []
      }
      company_routing_settings: {
        Row: {
          company_id: string
          default_drive_mph: number
          default_service_minutes: number
          depot_address: string | null
          depot_lat: number | null
          depot_lng: number | null
          display_name: string | null
          duration_method: string
          duration_rules: Json | null
          pin_settings: Json
          updated_at: string
          updated_by: string | null
          visible_tech_ids: string[] | null
        }
        Insert: {
          company_id: string
          default_drive_mph?: number
          default_service_minutes?: number
          depot_address?: string | null
          depot_lat?: number | null
          depot_lng?: number | null
          display_name?: string | null
          duration_method?: string
          duration_rules?: Json | null
          pin_settings?: Json
          updated_at?: string
          updated_by?: string | null
          visible_tech_ids?: string[] | null
        }
        Update: {
          company_id?: string
          default_drive_mph?: number
          default_service_minutes?: number
          depot_address?: string | null
          depot_lat?: number | null
          depot_lng?: number | null
          display_name?: string | null
          duration_method?: string
          duration_rules?: Json | null
          pin_settings?: Json
          updated_at?: string
          updated_by?: string | null
          visible_tech_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "company_routing_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_tag_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          contact_id: string
          source: string
          tag_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          contact_id: string
          source?: string
          tag_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          contact_id?: string
          source?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tag_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tag_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tag_assignments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "txt_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "contact_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_tags: {
        Row: {
          color: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          label: string
          sort_order: number
        }
        Insert: {
          color?: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          sort_order?: number
        }
        Update: {
          color?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          client_id: string
          company_id: string
          created_at: string
          custom_fields: Json | null
          deleted_at: string | null
          email: string | null
          external_created_at: string | null
          external_id: string | null
          first_name: string | null
          id: string
          is_billing_contact: boolean
          is_primary: boolean
          last_name: string | null
          last_synced_at: string | null
          name: string | null
          phone: string | null
          phone_digits: string | null
          receives_followups: boolean | null
          receives_reminders: boolean | null
          role: string | null
          source: string
          title: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          company_id: string
          created_at?: string
          custom_fields?: Json | null
          deleted_at?: string | null
          email?: string | null
          external_created_at?: string | null
          external_id?: string | null
          first_name?: string | null
          id?: string
          is_billing_contact?: boolean
          is_primary?: boolean
          last_name?: string | null
          last_synced_at?: string | null
          name?: string | null
          phone?: string | null
          phone_digits?: string | null
          receives_followups?: boolean | null
          receives_reminders?: boolean | null
          role?: string | null
          source?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          company_id?: string
          created_at?: string
          custom_fields?: Json | null
          deleted_at?: string | null
          email?: string | null
          external_created_at?: string | null
          external_id?: string | null
          first_name?: string | null
          id?: string
          is_billing_contact?: boolean
          is_primary?: boolean
          last_name?: string | null
          last_synced_at?: string | null
          name?: string | null
          phone?: string | null
          phone_digits?: string | null
          receives_followups?: boolean | null
          receives_reminders?: boolean | null
          role?: string | null
          source?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_members: {
        Row: {
          archived_at: string | null
          conversation_id: string
          joined_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          conversation_id: string
          joined_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          conversation_id?: string
          joined_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          company_id: string
          created_at: string
          id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_log_entries: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          company_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          log_date: string
          office_notes: string | null
          route_sheet_name: string | null
          route_sheet_url: string | null
          secondary_tech_user_ids: string[]
          tech_user_id: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          company_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          id?: string
          log_date: string
          office_notes?: string | null
          route_sheet_name?: string | null
          route_sheet_url?: string | null
          secondary_tech_user_ids?: string[]
          tech_user_id: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          id?: string
          log_date?: string
          office_notes?: string | null
          route_sheet_name?: string | null
          route_sheet_url?: string | null
          secondary_tech_user_ids?: string[]
          tech_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_log_entries_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_entries_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_entries_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_entries_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_entries_tech_user_id_fkey"
            columns: ["tech_user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_entries_tech_user_id_fkey"
            columns: ["tech_user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_log_read_receipts: {
        Row: {
          company_id: string
          last_read_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          last_read_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          last_read_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_log_settings: {
        Row: {
          company_id: string
          completion_notify_room_ids: string[]
          completion_notify_user_ids: string[]
          created_at: string
          on_my_way_template: string | null
          update_notify_user_ids: string[]
          updated_at: string
        }
        Insert: {
          company_id: string
          completion_notify_room_ids?: string[]
          completion_notify_user_ids?: string[]
          created_at?: string
          on_my_way_template?: string | null
          update_notify_user_ids?: string[]
          updated_at?: string
        }
        Update: {
          company_id?: string
          completion_notify_room_ids?: string[]
          completion_notify_user_ids?: string[]
          created_at?: string
          on_my_way_template?: string | null
          update_notify_user_ids?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_log_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_log_skip_reasons: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          id: string
          label: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          company_id: string
          created_at?: string
          id?: string
          label: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          id?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      daily_log_stop_attachments: {
        Row: {
          company_id: string
          created_at: string
          file_name: string
          file_size: number
          file_type: string
          file_url: string
          id: string
          stop_id: string
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          company_id: string
          created_at?: string
          file_name: string
          file_size: number
          file_type: string
          file_url: string
          id?: string
          stop_id: string
          storage_path: string
          uploaded_by: string
        }
        Update: {
          company_id?: string
          created_at?: string
          file_name?: string
          file_size?: number
          file_type?: string
          file_url?: string
          id?: string
          stop_id?: string
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_log_stop_attachments_stop_id_fkey"
            columns: ["stop_id"]
            isOneToOne: false
            referencedRelation: "daily_log_stops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_stop_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_stop_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_log_stop_messages: {
        Row: {
          company_id: string
          content: string
          created_at: string
          id: string
          stop_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          content: string
          created_at?: string
          id?: string
          stop_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          content?: string
          created_at?: string
          id?: string
          stop_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_log_stop_messages_stop_id_fkey"
            columns: ["stop_id"]
            isOneToOne: false
            referencedRelation: "daily_log_stops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_stop_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_stop_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_log_stop_reports: {
        Row: {
          additional_services: string[]
          company_id: string
          created_at: string
          id: string
          issues_found: string[]
          main_service: string | null
          notes: string | null
          sent_at: string | null
          sent_by: string | null
          stop_id: string
          updated_at: string
        }
        Insert: {
          additional_services?: string[]
          company_id: string
          created_at?: string
          id?: string
          issues_found?: string[]
          main_service?: string | null
          notes?: string | null
          sent_at?: string | null
          sent_by?: string | null
          stop_id: string
          updated_at?: string
        }
        Update: {
          additional_services?: string[]
          company_id?: string
          created_at?: string
          id?: string
          issues_found?: string[]
          main_service?: string | null
          notes?: string | null
          sent_at?: string | null
          sent_by?: string | null
          stop_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_log_stop_reports_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_stop_reports_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_stop_reports_stop_id_fkey"
            columns: ["stop_id"]
            isOneToOne: true
            referencedRelation: "daily_log_stops"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_log_stops: {
        Row: {
          address: string
          arrived_at: string | null
          client_name: string
          client_phone: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          duration_minutes: number | null
          entry_id: string
          id: string
          instructions: string | null
          job_title: string | null
          jobber_visit_id: string | null
          lat: number | null
          line_items: Json
          lng: number | null
          notes: string | null
          office_reviewed_at: string | null
          office_reviewed_by: string | null
          on_my_way_eta_minutes: number | null
          on_my_way_sent_at: string | null
          ord: number
          pesticide_record_id: string | null
          pesticide_tech_notes: string | null
          scheduled_end_at: string | null
          scheduled_start_at: string | null
          skip_reason_id: string | null
          skip_reason_label: string | null
          status: string
          updated_at: string
          weather: Json | null
        }
        Insert: {
          address: string
          arrived_at?: string | null
          client_name: string
          client_phone?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          duration_minutes?: number | null
          entry_id: string
          id?: string
          instructions?: string | null
          job_title?: string | null
          jobber_visit_id?: string | null
          lat?: number | null
          line_items?: Json
          lng?: number | null
          notes?: string | null
          office_reviewed_at?: string | null
          office_reviewed_by?: string | null
          on_my_way_eta_minutes?: number | null
          on_my_way_sent_at?: string | null
          ord: number
          pesticide_record_id?: string | null
          pesticide_tech_notes?: string | null
          scheduled_end_at?: string | null
          scheduled_start_at?: string | null
          skip_reason_id?: string | null
          skip_reason_label?: string | null
          status?: string
          updated_at?: string
          weather?: Json | null
        }
        Update: {
          address?: string
          arrived_at?: string | null
          client_name?: string
          client_phone?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          duration_minutes?: number | null
          entry_id?: string
          id?: string
          instructions?: string | null
          job_title?: string | null
          jobber_visit_id?: string | null
          lat?: number | null
          line_items?: Json
          lng?: number | null
          notes?: string | null
          office_reviewed_at?: string | null
          office_reviewed_by?: string | null
          on_my_way_eta_minutes?: number | null
          on_my_way_sent_at?: string | null
          ord?: number
          pesticide_record_id?: string | null
          pesticide_tech_notes?: string | null
          scheduled_end_at?: string | null
          scheduled_start_at?: string | null
          skip_reason_id?: string | null
          skip_reason_label?: string | null
          status?: string
          updated_at?: string
          weather?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_log_stops_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_stops_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_stops_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "daily_log_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_stops_office_reviewed_by_fkey"
            columns: ["office_reviewed_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_stops_office_reviewed_by_fkey"
            columns: ["office_reviewed_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_stops_pesticide_record_id_fkey"
            columns: ["pesticide_record_id"]
            isOneToOne: false
            referencedRelation: "pesticide_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_stops_skip_reason_id_fkey"
            columns: ["skip_reason_id"]
            isOneToOne: false
            referencedRelation: "daily_log_skip_reasons"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_log_subscribers: {
        Row: {
          created_at: string
          entry_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          entry_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_log_subscribers_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "daily_log_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_subscribers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_subscribers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_log_update_reactions: {
        Row: {
          created_at: string
          emoji: string
          update_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          update_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          update_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_log_update_reactions_update_id_fkey"
            columns: ["update_id"]
            isOneToOne: false
            referencedRelation: "daily_log_updates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_update_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_update_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_log_updates: {
        Row: {
          company_id: string
          content: string
          created_at: string
          created_by: string
          entry_id: string
          id: string
          media_urls: Json | null
        }
        Insert: {
          company_id: string
          content: string
          created_at?: string
          created_by: string
          entry_id: string
          id?: string
          media_urls?: Json | null
        }
        Update: {
          company_id?: string
          content?: string
          created_at?: string
          created_by?: string
          entry_id?: string
          id?: string
          media_urls?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_log_updates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_updates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_updates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_updates_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "daily_log_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      dialer_ring_group_members: {
        Row: {
          created_at: string
          group_id: string
          member_timeout_sec: number
          position: number
          user_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          member_timeout_sec?: number
          position?: number
          user_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          member_timeout_sec?: number
          position?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dialer_ring_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "dialer_ring_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dialer_ring_group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dialer_ring_group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      dialer_ring_groups: {
        Row: {
          company_id: string
          created_at: string
          id: string
          name: string
          ring_mode: string
          ring_timeout_sec: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          name: string
          ring_mode?: string
          ring_timeout_sec?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          ring_mode?: string
          ring_timeout_sec?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dialer_ring_groups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      dialer_settings: {
        Row: {
          after_hours_routing: Json | null
          business_hours: Json | null
          company_id: string
          created_at: string
          default_caller_id_number: string | null
          disposition_options: Json | null
          dispositions_enabled: boolean
          fallback_voicemail_tts: string | null
          fallback_voicemail_url: string | null
          holidays: Json
          inbound_route_user_id: string | null
          ivr_config: Json
          ivr_enabled: boolean
          recording_consent_enabled: boolean
          recording_consent_notice: string | null
          recording_consent_url: string | null
          recording_enabled: boolean
          recording_pause_auto_resume_sec: number
          ring_timeout_sec: number
          updated_at: string
          voicemail_recipient_user_ids: string[]
        }
        Insert: {
          after_hours_routing?: Json | null
          business_hours?: Json | null
          company_id: string
          created_at?: string
          default_caller_id_number?: string | null
          disposition_options?: Json | null
          dispositions_enabled?: boolean
          fallback_voicemail_tts?: string | null
          fallback_voicemail_url?: string | null
          holidays?: Json
          inbound_route_user_id?: string | null
          ivr_config?: Json
          ivr_enabled?: boolean
          recording_consent_enabled?: boolean
          recording_consent_notice?: string | null
          recording_consent_url?: string | null
          recording_enabled?: boolean
          recording_pause_auto_resume_sec?: number
          ring_timeout_sec?: number
          updated_at?: string
          voicemail_recipient_user_ids?: string[]
        }
        Update: {
          after_hours_routing?: Json | null
          business_hours?: Json | null
          company_id?: string
          created_at?: string
          default_caller_id_number?: string | null
          disposition_options?: Json | null
          dispositions_enabled?: boolean
          fallback_voicemail_tts?: string | null
          fallback_voicemail_url?: string | null
          holidays?: Json
          inbound_route_user_id?: string | null
          ivr_config?: Json
          ivr_enabled?: boolean
          recording_consent_enabled?: boolean
          recording_consent_notice?: string | null
          recording_consent_url?: string | null
          recording_enabled?: boolean
          recording_pause_auto_resume_sec?: number
          ring_timeout_sec?: number
          updated_at?: string
          voicemail_recipient_user_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "dialer_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dialer_settings_inbound_route_user_id_fkey"
            columns: ["inbound_route_user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dialer_settings_inbound_route_user_id_fkey"
            columns: ["inbound_route_user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          company_id: string
          created_at: string | null
          department: string | null
          email: string | null
          first_name: string
          flsa_status: string | null
          gusto_job_uuid: string | null
          gusto_synced_at: string | null
          gusto_uuid: string | null
          hourly_rate: number | null
          id: string
          is_active: boolean | null
          job_title: string | null
          last_name: string
          pay_type: string
          phone: string | null
          preferred_name: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          department?: string | null
          email?: string | null
          first_name: string
          flsa_status?: string | null
          gusto_job_uuid?: string | null
          gusto_synced_at?: string | null
          gusto_uuid?: string | null
          hourly_rate?: number | null
          id?: string
          is_active?: boolean | null
          job_title?: string | null
          last_name: string
          pay_type: string
          phone?: string | null
          preferred_name?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          department?: string | null
          email?: string | null
          first_name?: string
          flsa_status?: string | null
          gusto_job_uuid?: string | null
          gusto_synced_at?: string | null
          gusto_uuid?: string | null
          hourly_rate?: number | null
          id?: string
          is_active?: boolean | null
          job_title?: string | null
          last_name?: string
          pay_type?: string
          phone?: string | null
          preferred_name?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      email_contact_tags: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          source: string
          tag: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          source?: string
          tag: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          source?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "email_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      email_contacts: {
        Row: {
          company_id: string
          created_at: string
          email: string
          first_name: string | null
          id: string
          imported_batch_id: string | null
          jobber_client_id: string | null
          last_name: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          email: string
          first_name?: string | null
          id?: string
          imported_batch_id?: string | null
          jobber_client_id?: string | null
          last_name?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          imported_batch_id?: string | null
          jobber_client_id?: string | null
          last_name?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      email_imports: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          created_count: number
          filename: string | null
          id: string
          list_type: string | null
          skipped_count: number
          source: string
          suppressed_count: number
          total_rows: number
          updated_count: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          created_count?: number
          filename?: string | null
          id?: string
          list_type?: string | null
          skipped_count?: number
          source?: string
          suppressed_count?: number
          total_rows?: number
          updated_count?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          created_count?: number
          filename?: string | null
          id?: string
          list_type?: string | null
          skipped_count?: number
          source?: string
          suppressed_count?: number
          total_rows?: number
          updated_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "email_imports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      email_suppressions: {
        Row: {
          company_id: string
          created_at: string
          email: string
          id: string
          reason: string
        }
        Insert: {
          company_id: string
          created_at?: string
          email: string
          id?: string
          reason: string
        }
        Update: {
          company_id?: string
          created_at?: string
          email?: string
          id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_suppressions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      email_settings: {
        Row: {
          company_id: string
          created_at: string
          domain_verified: boolean
          from_email: string | null
          from_name: string | null
          physical_address: string | null
          reply_to: string | null
          resend_domain_id: string | null
          sending_domain: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          domain_verified?: boolean
          from_email?: string | null
          from_name?: string | null
          physical_address?: string | null
          reply_to?: string | null
          resend_domain_id?: string | null
          sending_domain?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          domain_verified?: boolean
          from_email?: string | null
          from_name?: string | null
          physical_address?: string | null
          reply_to?: string | null
          resend_domain_id?: string | null
          sending_domain?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      external_links: {
        Row: {
          company_id: string
          created_at: string
          icon: string
          id: string
          name: string
          sort_order: number
          url: string
        }
        Insert: {
          company_id: string
          created_at?: string
          icon?: string
          id?: string
          name: string
          sort_order?: number
          url: string
        }
        Update: {
          company_id?: string
          created_at?: string
          icon?: string
          id?: string
          name?: string
          sort_order?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      fcm_tokens: {
        Row: {
          company_id: string
          created_at: string | null
          device_token: string
          id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string | null
          device_token: string
          id?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          device_token?: string
          id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fcm_tokens_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          company_id: string
          created_at: string
          filename: string
          height_px: number | null
          id: string
          message_id: string | null
          mime_type: string
          size_bytes: number
          storage_path: string
          uploader_id: string | null
          width_px: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          filename: string
          height_px?: number | null
          id?: string
          message_id?: string | null
          mime_type?: string
          size_bytes?: number
          storage_path: string
          uploader_id?: string | null
          width_px?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          filename?: string
          height_px?: number | null
          id?: string
          message_id?: string | null
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          uploader_id?: string | null
          width_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "files_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_alert_events: {
        Row: {
          alert_type: string
          company_id: string
          created_at: string
          device_id: string
          device_name: string
          id: string
          last_seen_at: string
          payload: Json
          resolved_at: string | null
          started_at: string
        }
        Insert: {
          alert_type: string
          company_id: string
          created_at?: string
          device_id: string
          device_name: string
          id?: string
          last_seen_at?: string
          payload?: Json
          resolved_at?: string | null
          started_at?: string
        }
        Update: {
          alert_type?: string
          company_id?: string
          created_at?: string
          device_id?: string
          device_name?: string
          id?: string
          last_seen_at?: string
          payload?: Json
          resolved_at?: string | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_alert_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_settings: {
        Row: {
          alert_after_hours: boolean
          alert_low_fuel: boolean
          alert_offline: boolean
          alert_recipient_room_ids: string[]
          alert_recipient_user_ids: string[]
          alert_speeding: boolean
          company_id: string
          created_at: string
          fuel_threshold_pct: number
          offline_timeout_min: number
          speed_threshold_mph: number
          updated_at: string
          work_hours_end: string
          work_hours_start: string
          work_tz: string
        }
        Insert: {
          alert_after_hours?: boolean
          alert_low_fuel?: boolean
          alert_offline?: boolean
          alert_recipient_room_ids?: string[]
          alert_recipient_user_ids?: string[]
          alert_speeding?: boolean
          company_id: string
          created_at?: string
          fuel_threshold_pct?: number
          offline_timeout_min?: number
          speed_threshold_mph?: number
          updated_at?: string
          work_hours_end?: string
          work_hours_start?: string
          work_tz?: string
        }
        Update: {
          alert_after_hours?: boolean
          alert_low_fuel?: boolean
          alert_offline?: boolean
          alert_recipient_room_ids?: string[]
          alert_recipient_user_ids?: string[]
          alert_speeding?: boolean
          company_id?: string
          created_at?: string
          fuel_threshold_pct?: number
          offline_timeout_min?: number
          speed_threshold_mph?: number
          updated_at?: string
          work_hours_end?: string
          work_hours_start?: string
          work_tz?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      form_submissions: {
        Row: {
          answers: Json
          company_id: string
          context_id: string | null
          context_type: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          form_id: string
          id: string
          jobber_client_id: string | null
          jobber_note_id: string | null
          metadata: Json | null
          notification_sent_at: string | null
          submitted_at: string
          submitted_by: string | null
        }
        Insert: {
          answers?: Json
          company_id: string
          context_id?: string | null
          context_type?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          form_id: string
          id?: string
          jobber_client_id?: string | null
          jobber_note_id?: string | null
          metadata?: Json | null
          notification_sent_at?: string | null
          submitted_at?: string
          submitted_by?: string | null
        }
        Update: {
          answers?: Json
          company_id?: string
          context_id?: string | null
          context_type?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          form_id?: string
          id?: string
          jobber_client_id?: string | null
          jobber_note_id?: string | null
          metadata?: Json | null
          notification_sent_at?: string | null
          submitted_at?: string
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_submissions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
        ]
      }
      forms: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          fields: Json
          id: string
          name: string
          notification_sms_template: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          fields?: Json
          id?: string
          name: string
          notification_sms_template?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          fields?: Json
          id?: string
          name?: string
          notification_sms_template?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      geocode_cache: {
        Row: {
          address_key: string
          created_at: string
          lat: number
          lng: number
        }
        Insert: {
          address_key: string
          created_at?: string
          lat: number
          lng: number
        }
        Update: {
          address_key?: string
          created_at?: string
          lat?: number
          lng?: number
        }
        Relationships: []
      }
      guardian_audit: {
        Row: {
          answer: string | null
          company_id: string
          conversation_id: string | null
          created_at: string
          guardian_tier: string | null
          id: string
          input_tokens: number | null
          is_test: boolean
          model: string | null
          output_tokens: number | null
          question: string
          room_id: string | null
          tools_called: Json
          user_id: string | null
          web_searches_used: number
        }
        Insert: {
          answer?: string | null
          company_id: string
          conversation_id?: string | null
          created_at?: string
          guardian_tier?: string | null
          id?: string
          input_tokens?: number | null
          is_test?: boolean
          model?: string | null
          output_tokens?: number | null
          question: string
          room_id?: string | null
          tools_called?: Json
          user_id?: string | null
          web_searches_used?: number
        }
        Update: {
          answer?: string | null
          company_id?: string
          conversation_id?: string | null
          created_at?: string
          guardian_tier?: string | null
          id?: string
          input_tokens?: number | null
          is_test?: boolean
          model?: string | null
          output_tokens?: number | null
          question?: string
          room_id?: string | null
          tools_called?: Json
          user_id?: string | null
          web_searches_used?: number
        }
        Relationships: [
          {
            foreignKeyName: "guardian_audit_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_audit_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_knowledge_doc_versions: {
        Row: {
          body: string
          company_id: string
          doc_id: string
          id: string
          saved_at: string
          saved_by: string | null
          title: string
        }
        Insert: {
          body: string
          company_id: string
          doc_id: string
          id?: string
          saved_at?: string
          saved_by?: string | null
          title: string
        }
        Update: {
          body?: string
          company_id?: string
          doc_id?: string
          id?: string
          saved_at?: string
          saved_by?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardian_knowledge_doc_versions_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "guardian_knowledge_docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_knowledge_doc_versions_saved_by_fkey"
            columns: ["saved_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_knowledge_doc_versions_saved_by_fkey"
            columns: ["saved_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_knowledge_docs: {
        Row: {
          always_include: boolean
          body: string
          company_id: string
          created_at: string
          id: string
          slug: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          always_include?: boolean
          body?: string
          company_id: string
          created_at?: string
          id?: string
          slug: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          always_include?: boolean
          body?: string
          company_id?: string
          created_at?: string
          id?: string
          slug?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guardian_knowledge_docs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_knowledge_docs_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_knowledge_docs_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_settings: {
        Row: {
          company_id: string
          model: string
          updated_at: string | null
          updated_by: string | null
          web_search_daily_cap: number
        }
        Insert: {
          company_id: string
          model?: string
          updated_at?: string | null
          updated_by?: string | null
          web_search_daily_cap?: number
        }
        Update: {
          company_id?: string
          model?: string
          updated_at?: string | null
          updated_by?: string | null
          web_search_daily_cap?: number
        }
        Relationships: [
          {
            foreignKeyName: "guardian_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_web_search_usage: {
        Row: {
          company_id: string
          count: number
          date: string
          id: string
        }
        Insert: {
          company_id: string
          count?: number
          date?: string
          id?: string
        }
        Update: {
          company_id?: string
          count?: number
          date?: string
          id?: string
        }
        Relationships: []
      }
      holiday_overrides: {
        Row: {
          company_id: string
          created_at: string | null
          custom_hours: number | null
          employee_id: string
          holiday_id: string
          id: string
          notes: string | null
          pay_period_start: string
          updated_at: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          custom_hours?: number | null
          employee_id: string
          holiday_id: string
          id?: string
          notes?: string | null
          pay_period_start: string
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          custom_hours?: number | null
          employee_id?: string
          holiday_id?: string
          id?: string
          notes?: string | null
          pay_period_start?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "holiday_overrides_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holiday_overrides_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holiday_overrides_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "holiday_overrides_holiday_id_fkey"
            columns: ["holiday_id"]
            isOneToOne: false
            referencedRelation: "paid_holidays"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_announcements: {
        Row: {
          archived_at: string | null
          company_id: string
          content: string
          created_at: string
          created_by: string
          edited_at: string | null
          expires_at: string
          id: string
          type: string
        }
        Insert: {
          archived_at?: string | null
          company_id: string
          content: string
          created_at?: string
          created_by: string
          edited_at?: string | null
          expires_at: string
          id?: string
          type?: string
        }
        Update: {
          archived_at?: string | null
          company_id?: string
          content?: string
          created_at?: string
          created_by?: string
          edited_at?: string | null
          expires_at?: string
          id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "hub_announcements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_api_keys: {
        Row: {
          bot_user_id: string | null
          company_id: string
          created_at: string
          created_by: string
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
        }
        Insert: {
          bot_user_id?: string | null
          company_id: string
          created_at?: string
          created_by: string
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
        }
        Update: {
          bot_user_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hub_api_keys_bot_user_id_fkey"
            columns: ["bot_user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_api_keys_bot_user_id_fkey"
            columns: ["bot_user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_api_keys_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_automation_geofence_state: {
        Row: {
          device_id: string
          inside: boolean
          rule_id: string
          updated_at: string
        }
        Insert: {
          device_id: string
          inside?: boolean
          rule_id: string
          updated_at?: string
        }
        Update: {
          device_id?: string
          inside?: boolean
          rule_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hub_automation_geofence_state_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "hub_automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_automation_rules: {
        Row: {
          action_type: string
          active: boolean
          company_id: string
          condition_config: Json
          created_at: string
          created_by: string
          deliver_via: string
          id: string
          keyword: string | null
          last_fired_at: string | null
          message_template: string
          name: string | null
          recipient_type: string
          target_board_id: string | null
          target_room_id: string | null
          target_user_id: string | null
          trigger_config: Json
          trigger_room_id: string | null
          trigger_source: string
        }
        Insert: {
          action_type?: string
          active?: boolean
          company_id: string
          condition_config?: Json
          created_at?: string
          created_by: string
          deliver_via?: string
          id?: string
          keyword?: string | null
          last_fired_at?: string | null
          message_template: string
          name?: string | null
          recipient_type?: string
          target_board_id?: string | null
          target_room_id?: string | null
          target_user_id?: string | null
          trigger_config?: Json
          trigger_room_id?: string | null
          trigger_source?: string
        }
        Update: {
          action_type?: string
          active?: boolean
          company_id?: string
          condition_config?: Json
          created_at?: string
          created_by?: string
          deliver_via?: string
          id?: string
          keyword?: string | null
          last_fired_at?: string | null
          message_template?: string
          name?: string | null
          recipient_type?: string
          target_board_id?: string | null
          target_room_id?: string | null
          target_user_id?: string | null
          trigger_config?: Json
          trigger_room_id?: string | null
          trigger_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "hub_automation_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_automation_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_automation_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_automation_rules_target_board_id_fkey"
            columns: ["target_board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_automation_rules_target_room_id_fkey"
            columns: ["target_room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_automation_rules_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_automation_rules_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_automation_rules_trigger_room_id_fkey"
            columns: ["trigger_room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_automation_runs: {
        Row: {
          company_id: string
          detail: Json
          fired_at: string
          id: string
          recipient_user_ids: string[]
          rule_id: string | null
          trigger_source: string | null
        }
        Insert: {
          company_id: string
          detail?: Json
          fired_at?: string
          id?: string
          recipient_user_ids?: string[]
          rule_id?: string | null
          trigger_source?: string | null
        }
        Update: {
          company_id?: string
          detail?: Json
          fired_at?: string
          id?: string
          recipient_user_ids?: string[]
          rule_id?: string | null
          trigger_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hub_automation_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_automation_runs_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "hub_automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_contacts: {
        Row: {
          company_id: string
          created_at: string
          do_not_text: boolean
          email: string | null
          id: string
          jobber_client_id: string | null
          name: string
          notes: string | null
          phone: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          do_not_text?: boolean
          email?: string | null
          id?: string
          jobber_client_id?: string | null
          name: string
          notes?: string | null
          phone: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          do_not_text?: boolean
          email?: string | null
          id?: string
          jobber_client_id?: string | null
          name?: string
          notes?: string | null
          phone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hub_contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_file_tags: {
        Row: {
          color: string
          company_id: string
          created_at: string
          description: string | null
          id: string
          name: string
          tag_type: string
        }
        Insert: {
          color?: string
          company_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          tag_type?: string
        }
        Update: {
          color?: string
          company_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          tag_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "hub_file_tags_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_files: {
        Row: {
          company_id: string
          description: string | null
          filename: string
          id: string
          mime_type: string
          size_bytes: number
          social_used_at: string | null
          storage_path: string
          tags: string[]
          uploaded_at: string
          uploader_id: string | null
        }
        Insert: {
          company_id: string
          description?: string | null
          filename: string
          id?: string
          mime_type?: string
          size_bytes?: number
          social_used_at?: string | null
          storage_path: string
          tags?: string[]
          uploaded_at?: string
          uploader_id?: string | null
        }
        Update: {
          company_id?: string
          description?: string | null
          filename?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          social_used_at?: string | null
          storage_path?: string
          tags?: string[]
          uploaded_at?: string
          uploader_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hub_files_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_files_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_files_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_geofences: {
        Row: {
          address: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          lat: number
          lng: number
          name: string
          radius_m: number
        }
        Insert: {
          address?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          lat: number
          lng: number
          name: string
          radius_m?: number
        }
        Update: {
          address?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lat?: number
          lng?: number
          name?: string
          radius_m?: number
        }
        Relationships: [
          {
            foreignKeyName: "hub_geofences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_geofences_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_geofences_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_read_receipts: {
        Row: {
          company_id: string
          conversation_id: string | null
          id: string
          last_read_at: string
          room_id: string | null
          user_id: string
        }
        Insert: {
          company_id: string
          conversation_id?: string | null
          id?: string
          last_read_at?: string
          room_id?: string | null
          user_id: string
        }
        Update: {
          company_id?: string
          conversation_id?: string | null
          id?: string
          last_read_at?: string
          room_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hub_read_receipts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_read_receipts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_read_receipts_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_read_receipts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_read_receipts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_settings: {
        Row: {
          allow_member_room_creation: boolean
          company_id: string
          updated_at: string
        }
        Insert: {
          allow_member_room_creation?: boolean
          company_id: string
          updated_at?: string
        }
        Update: {
          allow_member_room_creation?: boolean
          company_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hub_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_sms_messages: {
        Row: {
          body: string
          captivated_sent: boolean
          company_id: string
          contact_id: string
          created_at: string
          direction: string
          id: string
          sent_by: string | null
          status: string
          twilio_sid: string | null
        }
        Insert: {
          body: string
          captivated_sent?: boolean
          company_id: string
          contact_id: string
          created_at?: string
          direction?: string
          id?: string
          sent_by?: string | null
          status?: string
          twilio_sid?: string | null
        }
        Update: {
          body?: string
          captivated_sent?: boolean
          company_id?: string
          contact_id?: string
          created_at?: string
          direction?: string
          id?: string
          sent_by?: string | null
          status?: string
          twilio_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hub_sms_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_sms_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "hub_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_sms_messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_sms_messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_users: {
        Row: {
          avatar_url: string | null
          claude_allowed: boolean
          company_id: string
          created_at: string
          display_name: string
          id: string
          is_bot: boolean
          last_active_at: string | null
          status: string
          status_emoji: string | null
          status_text: string | null
          status_until: string | null
        }
        Insert: {
          avatar_url?: string | null
          claude_allowed?: boolean
          company_id: string
          created_at?: string
          display_name?: string
          id: string
          is_bot?: boolean
          last_active_at?: string | null
          status?: string
          status_emoji?: string | null
          status_text?: string | null
          status_until?: string | null
        }
        Update: {
          avatar_url?: string | null
          claude_allowed?: boolean
          company_id?: string
          created_at?: string
          display_name?: string
          id?: string
          is_bot?: boolean
          last_active_at?: string | null
          status?: string
          status_emoji?: string | null
          status_text?: string | null
          status_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hub_users_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_vehicle_assignments: {
        Row: {
          company_id: string
          created_at: string
          device_id: string
          device_name: string | null
          effective_date: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          device_id: string
          device_name?: string | null
          effective_date?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          device_id?: string
          device_name?: string | null
          effective_date?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hub_vehicle_assignments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_vehicle_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_vehicle_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_locations: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          client_external_id: string | null
          client_id: string | null
          company_id: string
          created_at: string
          custom_fields: Json | null
          deleted_at: string | null
          deposit_amount: number | null
          discount_amount: number | null
          due_date: string | null
          external_created_at: string | null
          external_id: string | null
          id: string
          invoice_net_days: number | null
          invoice_number: string | null
          invoice_status: string | null
          issued_date: string | null
          job_external_id: string | null
          job_id: string | null
          jobber_web_uri: string | null
          last_synced_at: string | null
          outstanding_balance: number | null
          paid_at: string | null
          payments_total: number | null
          salesperson_external_id: string | null
          source: string
          subject: string | null
          subtotal: number | null
          tax_amount: number | null
          tips_total: number | null
          total: number | null
          updated_at: string
        }
        Insert: {
          client_external_id?: string | null
          client_id?: string | null
          company_id: string
          created_at?: string
          custom_fields?: Json | null
          deleted_at?: string | null
          deposit_amount?: number | null
          discount_amount?: number | null
          due_date?: string | null
          external_created_at?: string | null
          external_id?: string | null
          id?: string
          invoice_net_days?: number | null
          invoice_number?: string | null
          invoice_status?: string | null
          issued_date?: string | null
          job_external_id?: string | null
          job_id?: string | null
          jobber_web_uri?: string | null
          last_synced_at?: string | null
          outstanding_balance?: number | null
          paid_at?: string | null
          payments_total?: number | null
          salesperson_external_id?: string | null
          source?: string
          subject?: string | null
          subtotal?: number | null
          tax_amount?: number | null
          tips_total?: number | null
          total?: number | null
          updated_at?: string
        }
        Update: {
          client_external_id?: string | null
          client_id?: string | null
          company_id?: string
          created_at?: string
          custom_fields?: Json | null
          deleted_at?: string | null
          deposit_amount?: number | null
          discount_amount?: number | null
          due_date?: string | null
          external_created_at?: string | null
          external_id?: string | null
          id?: string
          invoice_net_days?: number | null
          invoice_number?: string | null
          invoice_status?: string | null
          issued_date?: string | null
          job_external_id?: string | null
          job_id?: string | null
          jobber_web_uri?: string | null
          last_synced_at?: string | null
          outstanding_balance?: number | null
          paid_at?: string | null
          payments_total?: number | null
          salesperson_external_id?: string | null
          source?: string
          subject?: string | null
          subtotal?: number | null
          tax_amount?: number | null
          tips_total?: number | null
          total?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_notes: {
        Row: {
          author_external_id: string | null
          body: string | null
          company_id: string
          created_at: string
          deleted_at: string | null
          external_created_at: string | null
          external_id: string | null
          id: string
          job_id: string
          last_synced_at: string | null
          source: string
        }
        Insert: {
          author_external_id?: string | null
          body?: string | null
          company_id: string
          created_at?: string
          deleted_at?: string | null
          external_created_at?: string | null
          external_id?: string | null
          id?: string
          job_id: string
          last_synced_at?: string | null
          source?: string
        }
        Update: {
          author_external_id?: string | null
          body?: string | null
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          external_created_at?: string | null
          external_id?: string | null
          id?: string
          job_id?: string
          last_synced_at?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_notes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobber_tokens: {
        Row: {
          access_token: string
          company_id: string
          created_at: string | null
          expires_at: string
          id: string
          refresh_token: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          company_id?: string
          created_at?: string | null
          expires_at: string
          id?: string
          refresh_token: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          company_id?: string
          created_at?: string | null
          expires_at?: string
          id?: string
          refresh_token?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobber_tokens_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      jobber_users: {
        Row: {
          company_id: string
          created_at: string | null
          email: string | null
          external_id: string
          id: string
          is_active: boolean
          last_synced_at: string | null
          name: string
          source: string
          updated_at: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          email?: string | null
          external_id: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          name: string
          source?: string
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          email?: string | null
          external_id?: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          name?: string
          source?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      jobs: {
        Row: {
          billing_type: string | null
          cancellation_reason: string | null
          client_external_id: string | null
          client_id: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          custom_fields: Json | null
          custom_note: string | null
          deleted_at: string | null
          dept_prefix: string | null
          end_at: string | null
          external_created_at: string | null
          external_id: string | null
          gate_code: string | null
          id: string
          invoiced_total: number | null
          is_recurring: boolean
          job_number: number | null
          job_status: string | null
          job_type: string | null
          jobber_web_uri: string | null
          last_synced_at: string | null
          lawn_size_k: number | null
          lawn_size_sqft: number | null
          neighborhood: string | null
          onsite_time: string | null
          po_number: string | null
          property_external_id: string | null
          property_id: string | null
          route_code: string | null
          route_type: string | null
          salesperson_external_id: string | null
          source: string
          start_at: string | null
          title: string | null
          total: number | null
          uninvoiced_total: number | null
          updated_at: string
        }
        Insert: {
          billing_type?: string | null
          cancellation_reason?: string | null
          client_external_id?: string | null
          client_id?: string | null
          company_id: string
          completed_at?: string | null
          created_at?: string
          custom_fields?: Json | null
          custom_note?: string | null
          deleted_at?: string | null
          dept_prefix?: string | null
          end_at?: string | null
          external_created_at?: string | null
          external_id?: string | null
          gate_code?: string | null
          id?: string
          invoiced_total?: number | null
          is_recurring?: boolean
          job_number?: number | null
          job_status?: string | null
          job_type?: string | null
          jobber_web_uri?: string | null
          last_synced_at?: string | null
          lawn_size_k?: number | null
          lawn_size_sqft?: number | null
          neighborhood?: string | null
          onsite_time?: string | null
          po_number?: string | null
          property_external_id?: string | null
          property_id?: string | null
          route_code?: string | null
          route_type?: string | null
          salesperson_external_id?: string | null
          source?: string
          start_at?: string | null
          title?: string | null
          total?: number | null
          uninvoiced_total?: number | null
          updated_at?: string
        }
        Update: {
          billing_type?: string | null
          cancellation_reason?: string | null
          client_external_id?: string | null
          client_id?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string
          custom_fields?: Json | null
          custom_note?: string | null
          deleted_at?: string | null
          dept_prefix?: string | null
          end_at?: string | null
          external_created_at?: string | null
          external_id?: string | null
          gate_code?: string | null
          id?: string
          invoiced_total?: number | null
          is_recurring?: boolean
          job_number?: number | null
          job_status?: string | null
          job_type?: string | null
          jobber_web_uri?: string | null
          last_synced_at?: string | null
          lawn_size_k?: number | null
          lawn_size_sqft?: number | null
          neighborhood?: string | null
          onsite_time?: string | null
          po_number?: string | null
          property_external_id?: string | null
          property_id?: string | null
          route_code?: string | null
          route_type?: string | null
          salesperson_external_id?: string | null
          source?: string
          start_at?: string | null
          title?: string | null
          total?: number | null
          uninvoiced_total?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_notes: {
        Row: {
          company_id: string | null
          created_at: string | null
          created_by: string | null
          id: string
          lead_id: string | null
          note: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          lead_id?: string | null
          note: string
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          lead_id?: string | null
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          annual_value: number | null
          auxiliary_services: string[] | null
          base_program_sold: string | null
          company_id: string | null
          created_at: string | null
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          lead_creation_date: string | null
          lead_source: string | null
          monday_item_id: string | null
          phone: string | null
          salesperson: string | null
          service: string[] | null
          service_address: string | null
          sold_date: string | null
          stage: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          annual_value?: number | null
          auxiliary_services?: string[] | null
          base_program_sold?: string | null
          company_id?: string | null
          created_at?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          lead_creation_date?: string | null
          lead_source?: string | null
          monday_item_id?: string | null
          phone?: string | null
          salesperson?: string | null
          service?: string[] | null
          service_address?: string | null
          sold_date?: string | null
          stage?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          annual_value?: number | null
          auxiliary_services?: string[] | null
          base_program_sold?: string | null
          company_id?: string | null
          created_at?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          lead_creation_date?: string | null
          lead_source?: string | null
          monday_item_id?: string | null
          phone?: string | null
          salesperson?: string | null
          service?: string[] | null
          service_address?: string | null
          sold_date?: string | null
          stage?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      line_items: {
        Row: {
          company_id: string
          created_at: string
          deleted_at: string | null
          dept_prefix: string | null
          description: string | null
          external_id: string | null
          id: string
          is_auxiliary: boolean
          is_recurring_program: boolean
          last_synced_at: string | null
          name: string
          parent_external_id: string
          parent_id: string | null
          parent_type: string
          quantity: number | null
          source: string
          total: number | null
          unit_price: number | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          deleted_at?: string | null
          dept_prefix?: string | null
          description?: string | null
          external_id?: string | null
          id?: string
          is_auxiliary?: boolean
          is_recurring_program?: boolean
          last_synced_at?: string | null
          name: string
          parent_external_id: string
          parent_id?: string | null
          parent_type: string
          quantity?: number | null
          source?: string
          total?: number | null
          unit_price?: number | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          dept_prefix?: string | null
          description?: string | null
          external_id?: string | null
          id?: string
          is_auxiliary?: boolean
          is_recurring_program?: boolean
          last_synced_at?: string | null
          name?: string
          parent_external_id?: string
          parent_id?: string | null
          parent_type?: string
          quantity?: number | null
          source?: string
          total?: number | null
          unit_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          company_id: string
          content: string
          conversation_id: string | null
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          forwarded_from: string | null
          id: string
          parent_id: string | null
          room_id: string | null
          sender_id: string | null
          slack_event_id: string | null
          slack_ts: string | null
          source: string | null
        }
        Insert: {
          company_id: string
          content?: string
          conversation_id?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          forwarded_from?: string | null
          id?: string
          parent_id?: string | null
          room_id?: string | null
          sender_id?: string | null
          slack_event_id?: string | null
          slack_ts?: string | null
          source?: string | null
        }
        Update: {
          company_id?: string
          content?: string
          conversation_id?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          forwarded_from?: string | null
          id?: string
          parent_id?: string | null
          room_id?: string | null
          sender_id?: string | null
          slack_event_id?: string | null
          slack_ts?: string | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_forwarded_from_fkey"
            columns: ["forwarded_from"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          dnd_enabled: boolean
          dnd_end: string | null
          dnd_start: string | null
          id: string
          level: string
          notification_sound: string | null
          room_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          dnd_enabled?: boolean
          dnd_end?: string | null
          dnd_start?: string | null
          id?: string
          level?: string
          notification_sound?: string | null
          room_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          dnd_enabled?: boolean
          dnd_end?: string | null
          dnd_start?: string | null
          id?: string
          level?: string
          notification_sound?: string | null
          room_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_prefs_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      paid_holidays: {
        Row: {
          company_id: string
          created_at: string | null
          date: string
          hours: number
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          company_id: string
          created_at?: string | null
          date: string
          hours?: number
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          date?: string
          hours?: number
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "paid_holidays_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      pesticide_line_item_mappings: {
        Row: {
          active: boolean
          active_ingredients: string | null
          application_rate: string | null
          chemical_name: string
          company_id: string
          created_at: string
          epa_registration_number: string | null
          id: string
          match_text: string
          match_type: string
          notes: string | null
          target_pests: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          active_ingredients?: string | null
          application_rate?: string | null
          chemical_name: string
          company_id: string
          created_at?: string
          epa_registration_number?: string | null
          id?: string
          match_text: string
          match_type?: string
          notes?: string | null
          target_pests?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          active_ingredients?: string | null
          application_rate?: string | null
          chemical_name?: string
          company_id?: string
          created_at?: string
          epa_registration_number?: string | null
          id?: string
          match_text?: string
          match_type?: string
          notes?: string | null
          target_pests?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pesticide_line_item_mappings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      pesticide_records: {
        Row: {
          application_timestamp: string
          chemicals_applied: Json
          company_id: string
          created_at: string
          customer_name: string | null
          daily_log_entry_id: string | null
          id: string
          jobber_client_id: string | null
          jobber_visit_id: string | null
          line_items: Json
          location_address: string | null
          location_lat: number | null
          location_lng: number | null
          notes: string | null
          stop_id: string | null
          tech_notes: string | null
          technician_name: string | null
          technician_user_id: string | null
          updated_at: string
          weather: Json | null
        }
        Insert: {
          application_timestamp: string
          chemicals_applied?: Json
          company_id: string
          created_at?: string
          customer_name?: string | null
          daily_log_entry_id?: string | null
          id?: string
          jobber_client_id?: string | null
          jobber_visit_id?: string | null
          line_items?: Json
          location_address?: string | null
          location_lat?: number | null
          location_lng?: number | null
          notes?: string | null
          stop_id?: string | null
          tech_notes?: string | null
          technician_name?: string | null
          technician_user_id?: string | null
          updated_at?: string
          weather?: Json | null
        }
        Update: {
          application_timestamp?: string
          chemicals_applied?: Json
          company_id?: string
          created_at?: string
          customer_name?: string | null
          daily_log_entry_id?: string | null
          id?: string
          jobber_client_id?: string | null
          jobber_visit_id?: string | null
          line_items?: Json
          location_address?: string | null
          location_lat?: number | null
          location_lng?: number | null
          notes?: string | null
          stop_id?: string | null
          tech_notes?: string | null
          technician_name?: string | null
          technician_user_id?: string | null
          updated_at?: string
          weather?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "pesticide_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pesticide_records_daily_log_entry_id_fkey"
            columns: ["daily_log_entry_id"]
            isOneToOne: false
            referencedRelation: "daily_log_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pesticide_records_stop_id_fkey"
            columns: ["stop_id"]
            isOneToOne: false
            referencedRelation: "daily_log_stops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pesticide_records_technician_user_id_fkey"
            columns: ["technician_user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pesticide_records_technician_user_id_fkey"
            columns: ["technician_user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      product_location_inventory: {
        Row: {
          company_id: string
          created_at: string
          id: string
          location_id: string
          product_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          location_id: string
          product_id: string
          quantity?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          location_id?: string
          product_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_location_inventory_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_location_inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          application_rate: number | null
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          label: string | null
          notes: string | null
          product_id: string
          rate_basis: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          application_rate?: number | null
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          notes?: string | null
          product_id: string
          rate_basis?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          application_rate?: number | null
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          notes?: string | null
          product_id?: string
          rate_basis?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active_ingredient: string | null
          batch_date: string | null
          batch_number: string | null
          category_id: string | null
          company_id: string
          created_at: string
          description: string | null
          epa_reg_number: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          package_price: number | null
          package_size: number | null
          sort_order: number
          unit: string | null
          updated_at: string
        }
        Insert: {
          active_ingredient?: string | null
          batch_date?: string | null
          batch_number?: string | null
          category_id?: string | null
          company_id: string
          created_at?: string
          description?: string | null
          epa_reg_number?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          package_price?: number | null
          package_size?: number | null
          sort_order?: number
          unit?: string | null
          updated_at?: string
        }
        Update: {
          active_ingredient?: string | null
          batch_date?: string | null
          batch_number?: string | null
          category_id?: string | null
          company_id?: string
          created_at?: string
          description?: string | null
          epa_reg_number?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          package_price?: number | null
          package_size?: number | null
          sort_order?: number
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          client_external_id: string | null
          client_id: string | null
          company_id: string
          created_at: string
          custom_fields: Json | null
          deleted_at: string | null
          external_created_at: string | null
          external_id: string | null
          gate_code: string | null
          id: string
          irrigation_zones: number | null
          is_billing_address: boolean | null
          jobber_web_uri: string | null
          last_synced_at: string | null
          latitude: number | null
          lawn_size_k: number | null
          lawn_size_sqft: number | null
          longitude: number | null
          name: string | null
          neighborhood: string | null
          source: string
          sprinkler_system: boolean | null
          state: string | null
          updated_at: string
          zip: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          client_external_id?: string | null
          client_id?: string | null
          company_id: string
          created_at?: string
          custom_fields?: Json | null
          deleted_at?: string | null
          external_created_at?: string | null
          external_id?: string | null
          gate_code?: string | null
          id?: string
          irrigation_zones?: number | null
          is_billing_address?: boolean | null
          jobber_web_uri?: string | null
          last_synced_at?: string | null
          latitude?: number | null
          lawn_size_k?: number | null
          lawn_size_sqft?: number | null
          longitude?: number | null
          name?: string | null
          neighborhood?: string | null
          source?: string
          sprinkler_system?: boolean | null
          state?: string | null
          updated_at?: string
          zip?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          client_external_id?: string | null
          client_id?: string | null
          company_id?: string
          created_at?: string
          custom_fields?: Json | null
          deleted_at?: string | null
          external_created_at?: string | null
          external_id?: string | null
          gate_code?: string | null
          id?: string
          irrigation_zones?: number | null
          is_billing_address?: boolean | null
          jobber_web_uri?: string | null
          last_synced_at?: string | null
          latitude?: number | null
          lawn_size_k?: number | null
          lawn_size_sqft?: number | null
          longitude?: number | null
          name?: string | null
          neighborhood?: string | null
          source?: string
          sprinkler_system?: boolean | null
          state?: string | null
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      pto_policies: {
        Row: {
          accrual_notes: string | null
          anniversary_date: string | null
          annual_hours: number
          company_id: string
          created_at: string | null
          employee_id: string
          id: string
          updated_at: string | null
        }
        Insert: {
          accrual_notes?: string | null
          anniversary_date?: string | null
          annual_hours?: number
          company_id: string
          created_at?: string | null
          employee_id: string
          id?: string
          updated_at?: string | null
        }
        Update: {
          accrual_notes?: string | null
          anniversary_date?: string | null
          annual_hours?: number
          company_id?: string
          created_at?: string | null
          employee_id?: string
          id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pto_policies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pto_policies_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pto_policies_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      pto_requests: {
        Row: {
          admin_note: string | null
          company_id: string
          created_at: string | null
          employee_id: string
          hours: number
          id: string
          note: string | null
          request_date: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          type: string
        }
        Insert: {
          admin_note?: string | null
          company_id: string
          created_at?: string | null
          employee_id: string
          hours: number
          id?: string
          note?: string | null
          request_date: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          type: string
        }
        Update: {
          admin_note?: string | null
          company_id?: string
          created_at?: string | null
          employee_id?: string
          hours?: number
          id?: string
          note?: string | null
          request_date?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "pto_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pto_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pto_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          company_id: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth_key: string
          company_id: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth_key?: string
          company_id?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_tokens: {
        Row: {
          access_token: string
          company_id: string
          expires_at: string
          id: string
          realm_id: string
          refresh_token: string
          updated_at: string | null
        }
        Insert: {
          access_token: string
          company_id?: string
          expires_at: string
          id?: string
          realm_id: string
          refresh_token: string
          updated_at?: string | null
        }
        Update: {
          access_token?: string
          company_id?: string
          expires_at?: string
          id?: string
          realm_id?: string
          refresh_token?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qbo_tokens_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      reactions: {
        Row: {
          created_at: string
          emoji: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_program_definitions: {
        Row: {
          created_at: string
          dept_prefix: string
          display_name: string
          id: string
          is_auxiliary: boolean
          is_recurring: boolean
          line_item_name: string
          program_group: string | null
          visits_per_year: number | null
        }
        Insert: {
          created_at?: string
          dept_prefix: string
          display_name: string
          id?: string
          is_auxiliary?: boolean
          is_recurring?: boolean
          line_item_name: string
          program_group?: string | null
          visits_per_year?: number | null
        }
        Update: {
          created_at?: string
          dept_prefix?: string
          display_name?: string
          id?: string
          is_auxiliary?: boolean
          is_recurring?: boolean
          line_item_name?: string
          program_group?: string | null
          visits_per_year?: number | null
        }
        Relationships: []
      }
      recurring_services: {
        Row: {
          annual_value: number | null
          auxiliary_services: string[] | null
          base_program_sold: string | null
          cancel_date: string | null
          cancellation_reason: string | null
          cancelled_status: string | null
          company_id: string
          created_at: string
          email: string | null
          id: string
          lead_comments: string | null
          lead_creation_date: string | null
          lead_id: string | null
          lead_source: string | null
          monday_group: string | null
          monday_item_id: string | null
          name: string | null
          phone: string | null
          salesperson: string | null
          service: string[] | null
          sold_date: string | null
          source: string
          status: string | null
          temp_prepaid: boolean
          temp_updated: boolean
          updated_at: string
        }
        Insert: {
          annual_value?: number | null
          auxiliary_services?: string[] | null
          base_program_sold?: string | null
          cancel_date?: string | null
          cancellation_reason?: string | null
          cancelled_status?: string | null
          company_id: string
          created_at?: string
          email?: string | null
          id?: string
          lead_comments?: string | null
          lead_creation_date?: string | null
          lead_id?: string | null
          lead_source?: string | null
          monday_group?: string | null
          monday_item_id?: string | null
          name?: string | null
          phone?: string | null
          salesperson?: string | null
          service?: string[] | null
          sold_date?: string | null
          source?: string
          status?: string | null
          temp_prepaid?: boolean
          temp_updated?: boolean
          updated_at?: string
        }
        Update: {
          annual_value?: number | null
          auxiliary_services?: string[] | null
          base_program_sold?: string | null
          cancel_date?: string | null
          cancellation_reason?: string | null
          cancelled_status?: string | null
          company_id?: string
          created_at?: string
          email?: string | null
          id?: string
          lead_comments?: string | null
          lead_creation_date?: string | null
          lead_id?: string | null
          lead_source?: string | null
          monday_group?: string | null
          monday_item_id?: string | null
          name?: string | null
          phone?: string | null
          salesperson?: string | null
          service?: string[] | null
          sold_date?: string | null
          source?: string
          status?: string | null
          temp_prepaid?: boolean
          temp_updated?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_services_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      responder_calls: {
        Row: {
          call_duration_seconds: number | null
          call_sid: string
          called_at: string
          company_id: string
          created_at: string
          email_sent: boolean
          email_sent_at: string | null
          error_message: string | null
          from_number: string | null
          has_voicemail: boolean
          id: string
          recording_duration_seconds: number | null
          recording_url: string | null
          template_used: string | null
          text_sent: boolean
          text_sent_at: string | null
          to_number: string | null
          transcript: string | null
          updated_at: string
        }
        Insert: {
          call_duration_seconds?: number | null
          call_sid: string
          called_at?: string
          company_id?: string
          created_at?: string
          email_sent?: boolean
          email_sent_at?: string | null
          error_message?: string | null
          from_number?: string | null
          has_voicemail?: boolean
          id?: string
          recording_duration_seconds?: number | null
          recording_url?: string | null
          template_used?: string | null
          text_sent?: boolean
          text_sent_at?: string | null
          to_number?: string | null
          transcript?: string | null
          updated_at?: string
        }
        Update: {
          call_duration_seconds?: number | null
          call_sid?: string
          called_at?: string
          company_id?: string
          created_at?: string
          email_sent?: boolean
          email_sent_at?: string | null
          error_message?: string | null
          from_number?: string | null
          has_voicemail?: boolean
          id?: string
          recording_duration_seconds?: number | null
          recording_url?: string | null
          template_used?: string | null
          text_sent?: boolean
          text_sent_at?: string | null
          to_number?: string | null
          transcript?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "responder_calls_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      responder_settings: {
        Row: {
          afterhours_no_message_template: string | null
          afterhours_template: string
          ai_reply_enabled: boolean
          ai_reply_prompt: string | null
          business_days: number[]
          business_hours_end: string
          business_hours_no_message_template: string | null
          business_hours_start: string
          business_hours_template: string
          company_id: string
          created_at: string
          forwarded_line_ring_sec: number
          id: string
          is_active: boolean
          mode: string
          notification_emails: string
          twilio_phone_number: string | null
          updated_at: string
          voicemail_greeting: string
        }
        Insert: {
          afterhours_no_message_template?: string | null
          afterhours_template?: string
          ai_reply_enabled?: boolean
          ai_reply_prompt?: string | null
          business_days?: number[]
          business_hours_end?: string
          business_hours_no_message_template?: string | null
          business_hours_start?: string
          business_hours_template?: string
          company_id?: string
          created_at?: string
          forwarded_line_ring_sec?: number
          id?: string
          is_active?: boolean
          mode?: string
          notification_emails?: string
          twilio_phone_number?: string | null
          updated_at?: string
          voicemail_greeting?: string
        }
        Update: {
          afterhours_no_message_template?: string | null
          afterhours_template?: string
          ai_reply_enabled?: boolean
          ai_reply_prompt?: string | null
          business_days?: number[]
          business_hours_end?: string
          business_hours_no_message_template?: string | null
          business_hours_start?: string
          business_hours_template?: string
          company_id?: string
          created_at?: string
          forwarded_line_ring_sec?: number
          id?: string
          is_active?: boolean
          mode?: string
          notification_emails?: string
          twilio_phone_number?: string | null
          updated_at?: string
          voicemail_greeting?: string
        }
        Relationships: [
          {
            foreignKeyName: "responder_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      room_members: {
        Row: {
          joined_at: string
          role: string
          room_id: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          role?: string
          room_id: string
          user_id: string
        }
        Update: {
          joined_at?: string
          role?: string
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          archived_at: string | null
          claude_enabled: boolean
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          guardian_full_access: boolean
          id: string
          is_private: boolean
          name: string
        }
        Insert: {
          archived_at?: string | null
          claude_enabled?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          guardian_full_access?: boolean
          id?: string
          is_private?: boolean
          name: string
        }
        Update: {
          archived_at?: string | null
          claude_enabled?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          guardian_full_access?: boolean
          id?: string
          is_private?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      route_batches: {
        Row: {
          assigned_date: string
          assigned_tech_jobber_id: string | null
          assigned_tech_name: string | null
          company_id: string
          created_at: string
          created_by: string | null
          depot_lat: number | null
          depot_lng: number | null
          id: string
          label: string | null
          sent_to_daily_log_at: string | null
          sent_to_jobber_at: string | null
          stops: Json
          total_drive_minutes: number
          total_miles: number
          total_onsite_minutes: number
        }
        Insert: {
          assigned_date: string
          assigned_tech_jobber_id?: string | null
          assigned_tech_name?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          depot_lat?: number | null
          depot_lng?: number | null
          id?: string
          label?: string | null
          sent_to_daily_log_at?: string | null
          sent_to_jobber_at?: string | null
          stops?: Json
          total_drive_minutes?: number
          total_miles?: number
          total_onsite_minutes?: number
        }
        Update: {
          assigned_date?: string
          assigned_tech_jobber_id?: string | null
          assigned_tech_name?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          depot_lat?: number | null
          depot_lng?: number | null
          id?: string
          label?: string | null
          sent_to_daily_log_at?: string | null
          sent_to_jobber_at?: string | null
          stops?: Json
          total_drive_minutes?: number
          total_miles?: number
          total_onsite_minutes?: number
        }
        Relationships: []
      }
      route_capacity: {
        Row: {
          client_name: string | null
          company_id: string
          created_at: string
          drive_time: number | null
          id: string
          job_external_id: string | null
          job_title: string | null
          lawn_size: string | null
          line_items: string | null
          monday_group: string | null
          monday_item_id: string | null
          name: string | null
          service_city: string | null
          service_province: string | null
          service_street: string | null
          service_zip: string | null
          size_helper: string | null
          source: string
          sync_date: string | null
          total: number | null
          updated_at: string
        }
        Insert: {
          client_name?: string | null
          company_id: string
          created_at?: string
          drive_time?: number | null
          id?: string
          job_external_id?: string | null
          job_title?: string | null
          lawn_size?: string | null
          line_items?: string | null
          monday_group?: string | null
          monday_item_id?: string | null
          name?: string | null
          service_city?: string | null
          service_province?: string | null
          service_street?: string | null
          service_zip?: string | null
          size_helper?: string | null
          source?: string
          sync_date?: string | null
          total?: number | null
          updated_at?: string
        }
        Update: {
          client_name?: string | null
          company_id?: string
          created_at?: string
          drive_time?: number | null
          id?: string
          job_external_id?: string | null
          job_title?: string | null
          lawn_size?: string | null
          line_items?: string | null
          monday_group?: string | null
          monday_item_id?: string | null
          name?: string | null
          service_city?: string | null
          service_province?: string | null
          service_street?: string | null
          service_zip?: string | null
          size_helper?: string | null
          source?: string
          sync_date?: string | null
          total?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      route_definitions: {
        Row: {
          created_at: string
          mix_gal_per_k: number
          program_group: string
          programs: string[]
          route_code: string
          route_type: string
          visits_per_year: number
        }
        Insert: {
          created_at?: string
          mix_gal_per_k?: number
          program_group: string
          programs: string[]
          route_code: string
          route_type: string
          visits_per_year: number
        }
        Update: {
          created_at?: string
          mix_gal_per_k?: number
          program_group?: string
          programs?: string[]
          route_code?: string
          route_type?: string
          visits_per_year?: number
        }
        Relationships: []
      }
      scheduled_messages: {
        Row: {
          company_id: string
          content: string
          conversation_id: string | null
          created_at: string
          files: Json | null
          id: string
          parent_id: string | null
          room_id: string | null
          send_at: string
          sender_id: string
          sent_at: string | null
        }
        Insert: {
          company_id: string
          content?: string
          conversation_id?: string | null
          created_at?: string
          files?: Json | null
          id?: string
          parent_id?: string | null
          room_id?: string | null
          send_at: string
          sender_id: string
          sent_at?: string | null
        }
        Update: {
          company_id?: string
          content?: string
          conversation_id?: string | null
          created_at?: string
          files?: Json | null
          id?: string
          parent_id?: string | null
          room_id?: string | null
          send_at?: string
          sender_id?: string
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      scoreboard_board_access: {
        Row: {
          board_slug: string
          company_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          board_slug: string
          company_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          board_slug?: string
          company_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      scoreboard_technicians: {
        Row: {
          board_slug: string
          company_id: string
          created_at: string
          employee_id: string
          id: string
        }
        Insert: {
          board_slug: string
          company_id: string
          created_at?: string
          employee_id: string
          id?: string
        }
        Update: {
          board_slug?: string
          company_id?: string
          created_at?: string
          employee_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scoreboard_technicians_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoreboard_technicians_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      service_definitions: {
        Row: {
          color: string
          created_at: string
          is_active: boolean
          name: string
          prefix: string
        }
        Insert: {
          color: string
          created_at?: string
          is_active?: boolean
          name: string
          prefix: string
        }
        Update: {
          color?: string
          created_at?: string
          is_active?: boolean
          name?: string
          prefix?: string
        }
        Relationships: []
      }
      social_accounts: {
        Row: {
          access_token: string
          account_name: string
          active: boolean
          company_id: string
          created_at: string
          external_id: string
          id: string
          ig_user_id: string | null
          platform: string
          token_expires_at: string | null
          user_token: string | null
        }
        Insert: {
          access_token: string
          account_name: string
          active?: boolean
          company_id: string
          created_at?: string
          external_id: string
          id?: string
          ig_user_id?: string | null
          platform: string
          token_expires_at?: string | null
          user_token?: string | null
        }
        Update: {
          access_token?: string
          account_name?: string
          active?: boolean
          company_id?: string
          created_at?: string
          external_id?: string
          id?: string
          ig_user_id?: string | null
          platform?: string
          token_expires_at?: string | null
          user_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          account_id: string
          caption: string
          company_id: string
          created_at: string
          created_by: string | null
          error_message: string | null
          fb_post_id: string | null
          hub_file_id: string | null
          id: string
          platforms: string[]
          published_at: string | null
          scheduled_at: string
          status: string
        }
        Insert: {
          account_id: string
          caption?: string
          company_id: string
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          fb_post_id?: string | null
          hub_file_id?: string | null
          id?: string
          platforms?: string[]
          published_at?: string | null
          scheduled_at: string
          status?: string
        }
        Update: {
          account_id?: string
          caption?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          fb_post_id?: string | null
          hub_file_id?: string | null
          id?: string
          platforms?: string[]
          published_at?: string | null
          scheduled_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_hub_file_id_fkey"
            columns: ["hub_file_id"]
            isOneToOne: false
            referencedRelation: "hub_files"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_log: {
        Row: {
          company_id: string
          completed_at: string | null
          entity: string | null
          error_message: string | null
          id: string
          records_skipped: number | null
          records_upserted: number | null
          source: string
          started_at: string
          status: string
          sync_type: string
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          entity?: string | null
          error_message?: string | null
          id?: string
          records_skipped?: number | null
          records_upserted?: number | null
          source?: string
          started_at?: string
          status?: string
          sync_type: string
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          entity?: string | null
          error_message?: string | null
          id?: string
          records_skipped?: number | null
          records_upserted?: number | null
          source?: string
          started_at?: string
          status?: string
          sync_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          company_id: string
          created_at: string
          external_id: string | null
          id: string
          name: string
          source: string
        }
        Insert: {
          company_id: string
          created_at?: string
          external_id?: string | null
          id?: string
          name: string
          source?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          external_id?: string | null
          id?: string
          name?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          break_minutes: number | null
          clock_in: string
          clock_out: string | null
          company_id: string
          created_at: string | null
          date: string
          employee_id: string
          gusto_timesheet_uuid: string | null
          id: string
          notes: string | null
          overtime_hours: number | null
          pay_period_end: string | null
          pay_period_start: string | null
          pushed_to_gusto_at: string | null
          regular_hours: number | null
          total_hours: number | null
          updated_at: string | null
        }
        Insert: {
          break_minutes?: number | null
          clock_in: string
          clock_out?: string | null
          company_id?: string
          created_at?: string | null
          date: string
          employee_id: string
          gusto_timesheet_uuid?: string | null
          id?: string
          notes?: string | null
          overtime_hours?: number | null
          pay_period_end?: string | null
          pay_period_start?: string | null
          pushed_to_gusto_at?: string | null
          regular_hours?: number | null
          total_hours?: number | null
          updated_at?: string | null
        }
        Update: {
          break_minutes?: number | null
          clock_in?: string
          clock_out?: string | null
          company_id?: string
          created_at?: string | null
          date?: string
          employee_id?: string
          gusto_timesheet_uuid?: string | null
          id?: string
          notes?: string | null
          overtime_hours?: number | null
          pay_period_end?: string | null
          pay_period_start?: string | null
          pushed_to_gusto_at?: string | null
          regular_hours?: number | null
          total_hours?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      time_punch_edit_requests: {
        Row: {
          admin_note: string | null
          company_id: string
          created_at: string
          employee_id: string
          id: string
          new_clock_in: string | null
          new_clock_out: string | null
          reason: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          time_entry_id: string | null
        }
        Insert: {
          admin_note?: string | null
          company_id: string
          created_at?: string
          employee_id: string
          id?: string
          new_clock_in?: string | null
          new_clock_out?: string | null
          reason: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          time_entry_id?: string | null
        }
        Update: {
          admin_note?: string | null
          company_id?: string
          created_at?: string
          employee_id?: string
          id?: string
          new_clock_in?: string | null
          new_clock_out?: string | null
          reason?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          time_entry_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "time_punch_edit_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_punch_edit_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_punch_edit_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "time_punch_edit_requests_time_entry_id_fkey"
            columns: ["time_entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      time_punches: {
        Row: {
          company_id: string
          created_at: string | null
          edit_reason: string | null
          edited_by: string | null
          employee_id: string
          id: string
          lat: number | null
          lng: number | null
          note: string | null
          original_punched_at: string | null
          punch_type: string
          punched_at: string
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          edit_reason?: string | null
          edited_by?: string | null
          employee_id: string
          id?: string
          lat?: number | null
          lng?: number | null
          note?: string | null
          original_punched_at?: string | null
          punch_type: string
          punched_at: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          edit_reason?: string | null
          edited_by?: string | null
          employee_id?: string
          id?: string
          lat?: number | null
          lng?: number | null
          note?: string | null
          original_punched_at?: string | null
          punch_type?: string
          punched_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_punches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_punches_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_punches_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      timesheet_settings: {
        Row: {
          company_id: string
          created_at: string | null
          gps_enabled: boolean | null
          gps_visible_to_employee: boolean | null
          gusto_access_token: string | null
          gusto_refresh_token: string | null
          gusto_token_expires_at: string | null
          id: string
          overtime_threshold_daily: number | null
          overtime_threshold_weekly: number | null
          pay_period_frequency: string | null
          pay_period_start_day: number | null
          updated_at: string | null
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          gps_enabled?: boolean | null
          gps_visible_to_employee?: boolean | null
          gusto_access_token?: string | null
          gusto_refresh_token?: string | null
          gusto_token_expires_at?: string | null
          id?: string
          overtime_threshold_daily?: number | null
          overtime_threshold_weekly?: number | null
          pay_period_frequency?: string | null
          pay_period_start_day?: number | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          gps_enabled?: boolean | null
          gps_visible_to_employee?: boolean | null
          gusto_access_token?: string | null
          gusto_refresh_token?: string | null
          gusto_token_expires_at?: string | null
          id?: string
          overtime_threshold_daily?: number | null
          overtime_threshold_weekly?: number | null
          pay_period_frequency?: string | null
          pay_period_start_day?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      tracker_settings: {
        Row: {
          auxiliary_services_options: string[] | null
          base_program_sold_options: string[] | null
          company_id: string | null
          created_at: string | null
          id: string
          lead_source_options: string[] | null
          salesperson_options: string[] | null
          service_options: string[] | null
          stage_colors: Json | null
          status_colors: Json | null
          status_options: string[] | null
          status_stage_rules: Json | null
          updated_at: string | null
        }
        Insert: {
          auxiliary_services_options?: string[] | null
          base_program_sold_options?: string[] | null
          company_id?: string | null
          created_at?: string | null
          id?: string
          lead_source_options?: string[] | null
          salesperson_options?: string[] | null
          service_options?: string[] | null
          stage_colors?: Json | null
          status_colors?: Json | null
          status_options?: string[] | null
          status_stage_rules?: Json | null
          updated_at?: string | null
        }
        Update: {
          auxiliary_services_options?: string[] | null
          base_program_sold_options?: string[] | null
          company_id?: string | null
          created_at?: string | null
          id?: string
          lead_source_options?: string[] | null
          salesperson_options?: string[] | null
          service_options?: string[] | null
          stage_colors?: Json | null
          status_colors?: Json | null
          status_options?: string[] | null
          status_stage_rules?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tracker_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      txt_broadcast_recipients: {
        Row: {
          broadcast_id: string
          contact_id: string
          conversation_id: string | null
          error_message: string | null
          id: string
          message_id: string | null
          processed_at: string | null
          status: string
        }
        Insert: {
          broadcast_id: string
          contact_id: string
          conversation_id?: string | null
          error_message?: string | null
          id?: string
          message_id?: string | null
          processed_at?: string | null
          status?: string
        }
        Update: {
          broadcast_id?: string
          contact_id?: string
          conversation_id?: string | null
          error_message?: string | null
          id?: string
          message_id?: string | null
          processed_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "txt_broadcast_recipients_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "txt_broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_broadcast_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "txt_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_broadcast_recipients_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "txt_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_broadcast_recipients_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "txt_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      txt_broadcasts: {
        Row: {
          apply_signature: boolean
          body: string
          company_id: string
          completed_at: string | null
          created_at: string
          created_by: string
          failed_count: number
          id: string
          last_error: string | null
          recipient_count: number
          sent_count: number
          skipped_count: number
          started_at: string | null
          status: string
          throttle_mps: number
        }
        Insert: {
          apply_signature?: boolean
          body: string
          company_id: string
          completed_at?: string | null
          created_at?: string
          created_by: string
          failed_count?: number
          id?: string
          last_error?: string | null
          recipient_count?: number
          sent_count?: number
          skipped_count?: number
          started_at?: string | null
          status?: string
          throttle_mps?: number
        }
        Update: {
          apply_signature?: boolean
          body?: string
          company_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          failed_count?: number
          id?: string
          last_error?: string | null
          recipient_count?: number
          sent_count?: number
          skipped_count?: number
          started_at?: string | null
          status?: string
          throttle_mps?: number
        }
        Relationships: [
          {
            foreignKeyName: "txt_broadcasts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_broadcasts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_broadcasts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      txt_contacts: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          company_id: string
          company_name: string | null
          country: string | null
          created_at: string
          deleted_at: string | null
          do_not_text: boolean
          email: string | null
          email_status: string
          first_name: string | null
          id: string
          is_company: boolean
          jobber_client_id: string | null
          last_name: string | null
          manually_edited: boolean
          name: string
          notes: string | null
          phone: string
          phone_digits: string | null
          postal_code: string | null
          sources: string[]
          state: string | null
          updated_at: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          company_id: string
          company_name?: string | null
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          do_not_text?: boolean
          email?: string | null
          email_status?: string
          first_name?: string | null
          id?: string
          is_company?: boolean
          jobber_client_id?: string | null
          last_name?: string | null
          manually_edited?: boolean
          name: string
          notes?: string | null
          phone: string
          phone_digits?: string | null
          postal_code?: string | null
          sources?: string[]
          state?: string | null
          updated_at?: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          company_id?: string
          company_name?: string | null
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          do_not_text?: boolean
          email?: string | null
          email_status?: string
          first_name?: string | null
          id?: string
          is_company?: boolean
          jobber_client_id?: string | null
          last_name?: string | null
          manually_edited?: boolean
          name?: string
          notes?: string | null
          phone?: string
          phone_digits?: string | null
          postal_code?: string | null
          sources?: string[]
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "txt_contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      txt_conversation_contacts: {
        Row: {
          added_at: string
          contact_id: string
          conversation_id: string
        }
        Insert: {
          added_at?: string
          contact_id: string
          conversation_id: string
        }
        Update: {
          added_at?: string
          contact_id?: string
          conversation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "txt_conversation_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "txt_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_conversation_contacts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "txt_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      txt_conversation_members: {
        Row: {
          added_at: string
          added_by: string | null
          conversation_id: string
          role: string
          user_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          conversation_id: string
          role: string
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          conversation_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "txt_conversation_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_conversation_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "txt_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_conversation_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_conversation_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      txt_conversations: {
        Row: {
          archived_by: string | null
          assigned_to: string | null
          company_id: string
          contact_id: string | null
          created_at: string
          id: string
          kind: string
          last_inbound_at: string | null
          last_message_at: string | null
          last_message_direction: string | null
          last_message_preview: string | null
          phone_number_id: string | null
          source: string | null
          status: string
          twilio_conversation_sid: string | null
        }
        Insert: {
          archived_by?: string | null
          assigned_to?: string | null
          company_id: string
          contact_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_message_direction?: string | null
          last_message_preview?: string | null
          phone_number_id?: string | null
          source?: string | null
          status?: string
          twilio_conversation_sid?: string | null
        }
        Update: {
          archived_by?: string | null
          assigned_to?: string | null
          company_id?: string
          contact_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_message_direction?: string | null
          last_message_preview?: string | null
          phone_number_id?: string | null
          source?: string | null
          status?: string
          twilio_conversation_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "txt_conversations_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_conversations_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_conversations_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_conversations_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_conversations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "txt_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_conversations_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "txt_phone_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      txt_messages: {
        Row: {
          body: string | null
          company_id: string
          contact_id: string
          conversation_id: string
          created_at: string
          direction: string
          error_message: string | null
          id: string
          media_urls: string[]
          sent_by: string | null
          status: string
          twilio_sid: string | null
        }
        Insert: {
          body?: string | null
          company_id: string
          contact_id: string
          conversation_id: string
          created_at?: string
          direction: string
          error_message?: string | null
          id?: string
          media_urls?: string[]
          sent_by?: string | null
          status?: string
          twilio_sid?: string | null
        }
        Update: {
          body?: string | null
          company_id?: string
          contact_id?: string
          conversation_id?: string
          created_at?: string
          direction?: string
          error_message?: string | null
          id?: string
          media_urls?: string[]
          sent_by?: string | null
          status?: string
          twilio_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "txt_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "txt_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "txt_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      txt_notes: {
        Row: {
          body: string
          company_id: string
          conversation_id: string
          created_at: string
          created_by: string
          id: string
        }
        Insert: {
          body: string
          company_id: string
          conversation_id: string
          created_at?: string
          created_by: string
          id?: string
        }
        Update: {
          body?: string
          company_id?: string
          conversation_id?: string
          created_at?: string
          created_by?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "txt_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_notes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "txt_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      txt_phone_numbers: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_default: boolean
          label: string | null
          twilio_number: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string | null
          twilio_number: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string | null
          twilio_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "txt_phone_numbers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      txt_scheduled_messages: {
        Row: {
          body: string | null
          company_id: string
          conversation_id: string
          created_at: string
          error_message: string | null
          id: string
          media_urls: string[]
          send_at: string
          sender_id: string
          sent_at: string | null
          status: string
        }
        Insert: {
          body?: string | null
          company_id: string
          conversation_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          media_urls?: string[]
          send_at: string
          sender_id: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          body?: string | null
          company_id?: string
          conversation_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          media_urls?: string[]
          send_at?: string
          sender_id?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "txt_scheduled_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_scheduled_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "txt_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_scheduled_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_scheduled_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      txt_settings: {
        Row: {
          company_id: string
          on_my_way_template: string | null
          responder_notify_user_ids: string[] | null
          updated_at: string
        }
        Insert: {
          company_id: string
          on_my_way_template?: string | null
          responder_notify_user_ids?: string[] | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          on_my_way_template?: string | null
          responder_notify_user_ids?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "txt_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      txt_templates: {
        Row: {
          body: string
          company_id: string
          created_at: string
          id: string
          owner_user_id: string | null
          scope: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          company_id: string
          created_at?: string
          id?: string
          owner_user_id?: string | null
          scope: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          company_id?: string
          created_at?: string
          id?: string
          owner_user_id?: string | null
          scope?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "txt_templates_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "txt_templates_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          can_access_books: boolean
          can_access_call_log: boolean
          can_access_call_log2: boolean
          can_access_daily_log_v2: boolean
          can_access_dialer: boolean
          can_access_fleet: boolean
          can_access_forms: boolean
          can_access_hub: boolean
          can_access_lawn: boolean
          can_access_marketing: boolean
          can_access_email: boolean
          can_manage_drip: boolean
          can_access_beta: boolean
          can_access_responder: boolean
          can_access_files: boolean
          can_access_pesticide_records: boolean
          can_access_pricer: boolean | null
          can_access_routing: boolean
          can_access_scoreboards: boolean | null
          can_access_timesheet: boolean | null
          can_access_tracker: boolean | null
          can_access_txt: boolean
          can_access_unified_inbox: boolean
          can_access_zone_sizer: boolean
          can_admin_announcements: boolean
          can_admin_contacts: boolean
          can_admin_daily_log: boolean
          can_admin_dialer: boolean
          can_admin_file_tags: boolean
          can_admin_fleet: boolean
          can_admin_forms: boolean
          can_admin_guardian: boolean
          can_admin_hub: boolean
          can_admin_marketing: boolean
          can_admin_email: boolean
          can_admin_people: boolean
          can_admin_products: boolean
          can_admin_routing: boolean
          can_admin_timesheet: boolean
          can_admin_txt: boolean
          can_admin_zone_sizer: boolean
          can_assign_txt_threads: boolean
          can_post_shout_outs: boolean
          company_id: string
          created_at: string
          dialer_dnd_enabled: boolean
          dialer_dnd_schedule: Json
          dialer_extension: string | null
          dialer_global_ring: boolean
          full_name: string | null
          guardian_tier: string
          hub_dnd_enabled: boolean
          hub_dnd_schedule: Json | null
          hub_layout: Json | null
          hub_pinned_ids: string[]
          hub_seeded_apps: string[]
          hub_text_size: string | null
          id: string
          invite_sent_at: string | null
          landing_page: string
          last_activity_seen_at: string | null
          master_dnd_enabled: boolean
          master_dnd_schedule: Json | null
          phone: string | null
          rail_config: Json | null
          role: string
          tracker_column_layout: Json | null
          txt_default_number_id: string | null
          txt_signature: string | null
          updated_at: string
          voicemail_greeting_url: string | null
        }
        Insert: {
          can_access_books?: boolean
          can_access_call_log?: boolean
          can_access_call_log2?: boolean
          can_access_daily_log_v2?: boolean
          can_access_dialer?: boolean
          can_access_fleet?: boolean
          can_access_forms?: boolean
          can_access_hub?: boolean
          can_access_lawn?: boolean
          can_access_marketing?: boolean
          can_access_email?: boolean
          can_manage_drip?: boolean
          can_access_beta?: boolean
          can_access_responder?: boolean
          can_access_files?: boolean
          can_access_pesticide_records?: boolean
          can_access_pricer?: boolean | null
          can_access_routing?: boolean
          can_access_scoreboards?: boolean | null
          can_access_timesheet?: boolean | null
          can_access_tracker?: boolean | null
          can_access_txt?: boolean
          can_access_unified_inbox?: boolean
          can_access_zone_sizer?: boolean
          can_admin_announcements?: boolean
          can_admin_contacts?: boolean
          can_admin_daily_log?: boolean
          can_admin_dialer?: boolean
          can_admin_file_tags?: boolean
          can_admin_fleet?: boolean
          can_admin_forms?: boolean
          can_admin_guardian?: boolean
          can_admin_hub?: boolean
          can_admin_marketing?: boolean
          can_admin_email?: boolean
          can_admin_people?: boolean
          can_admin_products?: boolean
          can_admin_routing?: boolean
          can_admin_timesheet?: boolean
          can_admin_txt?: boolean
          can_admin_zone_sizer?: boolean
          can_assign_txt_threads?: boolean
          can_post_shout_outs?: boolean
          company_id?: string
          created_at?: string
          dialer_dnd_enabled?: boolean
          dialer_dnd_schedule?: Json
          dialer_extension?: string | null
          dialer_global_ring?: boolean
          full_name?: string | null
          guardian_tier?: string
          hub_dnd_enabled?: boolean
          hub_dnd_schedule?: Json | null
          hub_layout?: Json | null
          hub_pinned_ids?: string[]
          hub_seeded_apps?: string[]
          hub_text_size?: string | null
          id: string
          invite_sent_at?: string | null
          landing_page?: string
          last_activity_seen_at?: string | null
          master_dnd_enabled?: boolean
          master_dnd_schedule?: Json | null
          phone?: string | null
          rail_config?: Json | null
          role?: string
          tracker_column_layout?: Json | null
          txt_default_number_id?: string | null
          txt_signature?: string | null
          updated_at?: string
          voicemail_greeting_url?: string | null
        }
        Update: {
          can_access_books?: boolean
          can_access_call_log?: boolean
          can_access_call_log2?: boolean
          can_access_daily_log_v2?: boolean
          can_access_dialer?: boolean
          can_access_fleet?: boolean
          can_access_forms?: boolean
          can_access_hub?: boolean
          can_access_lawn?: boolean
          can_access_marketing?: boolean
          can_access_email?: boolean
          can_manage_drip?: boolean
          can_access_beta?: boolean
          can_access_responder?: boolean
          can_access_files?: boolean
          can_access_pesticide_records?: boolean
          can_access_pricer?: boolean | null
          can_access_routing?: boolean
          can_access_scoreboards?: boolean | null
          can_access_timesheet?: boolean | null
          can_access_tracker?: boolean | null
          can_access_txt?: boolean
          can_access_unified_inbox?: boolean
          can_access_zone_sizer?: boolean
          can_admin_announcements?: boolean
          can_admin_contacts?: boolean
          can_admin_daily_log?: boolean
          can_admin_dialer?: boolean
          can_admin_file_tags?: boolean
          can_admin_fleet?: boolean
          can_admin_forms?: boolean
          can_admin_guardian?: boolean
          can_admin_hub?: boolean
          can_admin_marketing?: boolean
          can_admin_email?: boolean
          can_admin_people?: boolean
          can_admin_products?: boolean
          can_admin_routing?: boolean
          can_admin_timesheet?: boolean
          can_admin_txt?: boolean
          can_admin_zone_sizer?: boolean
          can_assign_txt_threads?: boolean
          can_post_shout_outs?: boolean
          company_id?: string
          created_at?: string
          dialer_dnd_enabled?: boolean
          dialer_dnd_schedule?: Json
          dialer_extension?: string | null
          dialer_global_ring?: boolean
          full_name?: string | null
          guardian_tier?: string
          hub_dnd_enabled?: boolean
          hub_dnd_schedule?: Json | null
          hub_layout?: Json | null
          hub_pinned_ids?: string[]
          hub_seeded_apps?: string[]
          hub_text_size?: string | null
          id?: string
          invite_sent_at?: string | null
          landing_page?: string
          last_activity_seen_at?: string | null
          master_dnd_enabled?: boolean
          master_dnd_schedule?: Json | null
          phone?: string | null
          rail_config?: Json | null
          role?: string
          tracker_column_layout?: Json | null
          txt_default_number_id?: string | null
          txt_signature?: string | null
          updated_at?: string
          voicemail_greeting_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_txt_default_number_id_fkey"
            columns: ["txt_default_number_id"]
            isOneToOne: false
            referencedRelation: "txt_phone_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          company_id: string
          created_at: string | null
          default_drive_mph: number | null
          default_service_minutes: number | null
          depot_address: string | null
          depot_lat: number | null
          depot_lng: number | null
          display_name: string | null
          duration_method: string | null
          duration_rules: Json | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          default_drive_mph?: number | null
          default_service_minutes?: number | null
          depot_address?: string | null
          depot_lat?: number | null
          depot_lng?: number | null
          display_name?: string | null
          duration_method?: string | null
          duration_rules?: Json | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          default_drive_mph?: number | null
          default_service_minutes?: number | null
          depot_address?: string | null
          depot_lat?: number | null
          depot_lng?: number | null
          display_name?: string | null
          duration_method?: string | null
          duration_rules?: Json | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      visits: {
        Row: {
          client_external_id: string | null
          client_id: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          custom_fields: Json | null
          deleted_at: string | null
          end_at: string | null
          external_created_at: string | null
          external_id: string | null
          id: string
          invoice_external_id: string | null
          job_external_id: string | null
          job_id: string | null
          last_synced_at: string | null
          override_reason: string | null
          scheduled_date: string | null
          source: string
          start_at: string | null
          subtotal: number | null
          tech_external_user_ids: string[] | null
          title: string | null
          total: number | null
          updated_at: string
          visit_status: string | null
        }
        Insert: {
          client_external_id?: string | null
          client_id?: string | null
          company_id: string
          completed_at?: string | null
          created_at?: string
          custom_fields?: Json | null
          deleted_at?: string | null
          end_at?: string | null
          external_created_at?: string | null
          external_id?: string | null
          id?: string
          invoice_external_id?: string | null
          job_external_id?: string | null
          job_id?: string | null
          last_synced_at?: string | null
          override_reason?: string | null
          scheduled_date?: string | null
          source?: string
          start_at?: string | null
          subtotal?: number | null
          tech_external_user_ids?: string[] | null
          title?: string | null
          total?: number | null
          updated_at?: string
          visit_status?: string | null
        }
        Update: {
          client_external_id?: string | null
          client_id?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string
          custom_fields?: Json | null
          deleted_at?: string | null
          end_at?: string | null
          external_created_at?: string | null
          external_id?: string | null
          id?: string
          invoice_external_id?: string | null
          job_external_id?: string | null
          job_id?: string | null
          last_synced_at?: string | null
          override_reason?: string | null
          scheduled_date?: string | null
          source?: string
          start_at?: string | null
          subtotal?: number | null
          tech_external_user_ids?: string[] | null
          title?: string | null
          total?: number | null
          updated_at?: string
          visit_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visits_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      voicemails: {
        Row: {
          ai_reply_body: string | null
          ai_reply_sent_at: string | null
          call_id: string | null
          company_id: string
          contact_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          follow_up_at: string | null
          follow_up_by: string | null
          follow_up_status: string | null
          from_number: string | null
          heard_at: string | null
          heard_by: string | null
          id: string
          owner_user_id: string | null
          recording_duration_sec: number | null
          recording_storage_path: string
          summary: string | null
          transcript: string | null
          twilio_recording_sid: string | null
        }
        Insert: {
          ai_reply_body?: string | null
          ai_reply_sent_at?: string | null
          call_id?: string | null
          company_id: string
          contact_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          follow_up_at?: string | null
          follow_up_by?: string | null
          follow_up_status?: string | null
          from_number?: string | null
          heard_at?: string | null
          heard_by?: string | null
          id?: string
          owner_user_id?: string | null
          recording_duration_sec?: number | null
          recording_storage_path: string
          summary?: string | null
          transcript?: string | null
          twilio_recording_sid?: string | null
        }
        Update: {
          ai_reply_body?: string | null
          ai_reply_sent_at?: string | null
          call_id?: string | null
          company_id?: string
          contact_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          follow_up_at?: string | null
          follow_up_by?: string | null
          follow_up_status?: string | null
          from_number?: string | null
          heard_at?: string | null
          heard_by?: string | null
          id?: string
          owner_user_id?: string | null
          recording_duration_sec?: number | null
          recording_storage_path?: string
          summary?: string | null
          transcript?: string | null
          twilio_recording_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voicemails_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voicemails_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voicemails_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "txt_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voicemails_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voicemails_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voicemails_heard_by_fkey"
            columns: ["heard_by"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voicemails_heard_by_fkey"
            columns: ["heard_by"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voicemails_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "hub_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voicemails_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "hub_users_with_presence"
            referencedColumns: ["id"]
          },
        ]
      }
      zone_sizer_settings: {
        Row: {
          bed_sqft_per_zone: number
          company_id: string
          created_at: string
          turf_sqft_per_zone: number
          updated_at: string
        }
        Insert: {
          bed_sqft_per_zone?: number
          company_id: string
          created_at?: string
          turf_sqft_per_zone?: number
          updated_at?: string
        }
        Update: {
          bed_sqft_per_zone?: number
          company_id?: string
          created_at?: string
          turf_sqft_per_zone?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "zone_sizer_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      hub_users_with_presence: {
        Row: {
          avatar_url: string | null
          claude_allowed: boolean | null
          company_id: string | null
          created_at: string | null
          display_name: string | null
          effective_status: string | null
          employee_id: string | null
          employee_is_active: boolean | null
          id: string | null
          is_bot: boolean | null
          is_clocked_in: boolean | null
          last_active_at: string | null
          pay_type: string | null
          status: string | null
          status_emoji: string | null
          status_text: string | null
          status_until: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hub_users_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_access_room: { Args: { p_room_id: string }; Returns: boolean }
      get_admin_users: {
        Args: never
        Returns: {
          avatar_url: string
          can_access_books: boolean
          can_access_call_log: boolean
          can_access_call_log2: boolean
          can_access_daily_log_v2: boolean
          can_access_dialer: boolean
          can_access_fleet: boolean
          can_access_forms: boolean
          can_access_hub: boolean
          can_access_lawn: boolean
          can_access_marketing: boolean
          can_access_email: boolean
          can_manage_drip: boolean
          can_access_beta: boolean
          can_access_responder: boolean
          can_access_files: boolean
          can_access_pesticide_records: boolean
          can_access_pricer: boolean
          can_access_routing: boolean
          can_access_scoreboards: boolean
          can_access_timesheet: boolean
          can_access_tracker: boolean
          can_access_txt: boolean
          can_access_unified_inbox: boolean
          can_access_zone_sizer: boolean
          can_admin_announcements: boolean
          can_admin_contacts: boolean
          can_admin_daily_log: boolean
          can_admin_dialer: boolean
          can_admin_file_tags: boolean
          can_admin_fleet: boolean
          can_admin_forms: boolean
          can_admin_guardian: boolean
          can_admin_hub: boolean
          can_admin_marketing: boolean
          can_admin_email: boolean
          can_admin_people: boolean
          can_admin_products: boolean
          can_admin_routing: boolean
          can_admin_timesheet: boolean
          can_admin_txt: boolean
          can_admin_zone_sizer: boolean
          can_post_shout_outs: boolean
          created_at: string
          dialer_global_ring: boolean
          display_name: string
          email: string
          full_name: string
          id: string
          invite_sent_at: string
          last_sign_in_at: string
          phone: string
          role: string
        }[]
      }
      get_contact_timeline: {
        Args: { p_company_id: string; p_contact_id: string }
        Returns: {
          actor: string
          ai_reply_sent_at: string
          body: string
          direction: string
          duration_seconds: number
          id: string
          kind: string
          media_urls: string[]
          recording_path: string
          sentiment: string
          status: string
          summary: string
          transcript: string
          ts: string
          voicemail_id: string
        }[]
      }
      get_last_top_level_message_per_conversation: {
        Args: { conv_ids: string[] }
        Returns: {
          content: string
          conversation_id: string
          created_at: string
        }[]
      }
      get_my_company_id: { Args: never; Returns: string }
      get_unread_state_for_user: {
        Args: { p_company_id: string; p_user_id: string }
        Returns: {
          last_at: string
          scope: string
          scope_id: string
        }[]
      }
      get_visits_report: {
        Args: { p_company_id: string; p_end: string; p_start: string }
        Returns: {
          dept_prefix: string
          is_recurring: boolean
          tech_external_id: string
          tech_name: string
          total_value: number
          visit_count: number
        }[]
      }
      get_visits_report_detail: {
        Args: {
          p_company_id: string
          p_end: string
          p_start: string
          p_tech_external_id: string
        }
        Returns: {
          client_name: string
          dept_prefix: string
          is_recurring: boolean
          job_title: string
          scheduled_date: string
          total_value: number
          visit_id: string
        }[]
      }
      hub_files_remove_tag: {
        Args: { p_company_id: string; p_name: string }
        Returns: number
      }
      hub_files_rename_tag: {
        Args: { p_company_id: string; p_new_name: string; p_old_name: string }
        Returns: number
      }
      is_conversation_member: { Args: { conv_id: string }; Returns: boolean }
      is_employee_clocked_in: {
        Args: { p_employee_id: string }
        Returns: boolean
      }
      is_room_member: { Args: { p_room_id: string }; Returns: boolean }
      scoreboard_board_technicians: {
        Args: { p_board_slug: string; p_company_id: string }
        Returns: {
          display_name: string
          employee_id: string
          jobber_external_id: string
          salesperson_name: string
        }[]
      }
      scoreboard_churn_summary: {
        Args: { p_company_id: string; p_year: number }
        Returns: Json
      }
      scoreboard_ir_repair_ticket: {
        Args: { p_company_id: string; p_end: string; p_start: string }
        Returns: {
          avg_value: number
          median_value: number
          ticket_count: number
          total_value: number
        }[]
      }
      scoreboard_recurring_book: {
        Args: { p_company_id: string }
        Returns: {
          annual_value: number
          client_id: string
          dept_prefix: string
          display_name: string
          has_bwp: boolean
          has_phc: boolean
          job_id: string
        }[]
      }
      scoreboard_source_scorecard: {
        Args: { p_company_id: string; p_year: number }
        Returns: {
          source: string
          source_group: string
          cost_type: string
          total_customers: number
          active_count: number
          churned_count: number
          retention_pct: number
          new_in_year: number
          active_annual_value: number
          avg_annual_value: number
          avg_tenure_months: number
          est_ltv: number
          unresolved_count: number
        }[]
      }
      scoreboard_tech_hours: {
        Args: {
          p_company_id: string
          p_employee_id: string
          p_end: string
          p_start: string
        }
        Returns: number
      }
      scoreboard_tech_revenue: {
        Args: {
          p_bucket: string
          p_company_id: string
          p_end: string
          p_start: string
          p_tech_external_id: string
        }
        Returns: {
          bucket: string
          dept: string
          total: number
        }[]
      }
      scoreboard_techs_hours: {
        Args: {
          p_company_id: string
          p_employee_ids: string[]
          p_end: string
          p_start: string
        }
        Returns: {
          employee_id: string
          hours: number
        }[]
      }
      scoreboard_techs_revenue: {
        Args: {
          p_bucket: string
          p_company_id: string
          p_end: string
          p_start: string
          p_tech_external_ids: string[]
        }
        Returns: {
          bucket: string
          dept: string
          tech_external_id: string
          total: number
        }[]
      }
      scoreboard_visit_revenue: {
        Args: {
          p_bucket: string
          p_company_id: string
          p_end: string
          p_start: string
        }
        Returns: {
          bucket: string
          dept: string
          total: number
        }[]
      }
      scoreboard_wf_technicians: {
        Args: { p_company_id: string }
        Returns: {
          display_name: string
          employee_id: string
          jobber_external_id: string
          salesperson_name: string
        }[]
      }
      search_hub_messages: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          parent_id: string
          room_id: string
          room_name: string
          sender_avatar_url: string
          sender_display_name: string
        }[]
      }
      txt_latest_messages: {
        Args: { conv_ids: string[] }
        Returns: {
          body: string
          conversation_id: string
          direction: string
          media_count: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
