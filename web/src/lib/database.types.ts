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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          building_id: number
          created_at: string
          id: number
          kind: Database["public"]["Enums"]["alert_kind"]
          problem_id: number | null
          read_at: string | null
          report_id: string | null
          user_id: string
        }
        Insert: {
          building_id: number
          created_at?: string
          id?: never
          kind: Database["public"]["Enums"]["alert_kind"]
          problem_id?: number | null
          read_at?: string | null
          report_id?: string | null
          user_id: string
        }
        Update: {
          building_id?: number
          created_at?: string
          id?: never
          kind?: Database["public"]["Enums"]["alert_kind"]
          problem_id?: number | null
          read_at?: string | null
          report_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "alerts_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "complaints"
            referencedColumns: ["problem_id"]
          },
          {
            foreignKeyName: "alerts_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "resident_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      building_stats: {
        Row: {
          building_id: number
          complaint_days: number
          complaints_open: number
          complaints_total: number
          heat_complaints: number
          heat_days: number
          last_complaint_at: string | null
          no_access_closures: number
          refreshed_at: string
          season: number
        }
        Insert: {
          building_id: number
          complaint_days: number
          complaints_open: number
          complaints_total: number
          heat_complaints: number
          heat_days: number
          last_complaint_at?: string | null
          no_access_closures: number
          refreshed_at?: string
          season: number
        }
        Update: {
          building_id?: number
          complaint_days?: number
          complaints_open?: number
          complaints_total?: number
          heat_complaints?: number
          heat_days?: number
          last_complaint_at?: string | null
          no_access_closures?: number
          refreshed_at?: string
          season?: number
        }
        Relationships: [
          {
            foreignKeyName: "building_stats_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["building_id"]
          },
        ]
      }
      buildings: {
        Row: {
          address: string | null
          bbl: string | null
          bin: string | null
          borough: Database["public"]["Enums"]["borough"]
          building_id: number
          community_board: number | null
          council_district: number | null
          first_seen_at: string
          house_number: string
          latitude: number | null
          longitude: number | null
          nta: string | null
          postcode: string | null
          street_name: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          bbl?: string | null
          bin?: string | null
          borough: Database["public"]["Enums"]["borough"]
          building_id: number
          community_board?: number | null
          council_district?: number | null
          first_seen_at?: string
          house_number: string
          latitude?: number | null
          longitude?: number | null
          nta?: string | null
          postcode?: string | null
          street_name: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          bbl?: string | null
          bin?: string | null
          borough?: Database["public"]["Enums"]["borough"]
          building_id?: number
          community_board?: number | null
          council_district?: number | null
          first_seen_at?: string
          house_number?: string
          latitude?: number | null
          longitude?: number | null
          nta?: string | null
          postcode?: string | null
          street_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          first_seen: string
          name: string
        }
        Insert: {
          first_seen?: string
          name: string
        }
        Update: {
          first_seen?: string
          name?: string
        }
        Relationships: []
      }
      complaints: {
        Row: {
          apartment: string | null
          building_id: number
          category: string
          complaint_id: number
          complaint_status: Database["public"]["Enums"]["complaint_status"]
          ingested_at: string
          is_duplicate: boolean
          problem_code: string | null
          problem_id: number
          problem_status: Database["public"]["Enums"]["complaint_status"]
          received_at: string
          season: number | null
          source_updated_at: string
          space_type: string | null
          status_changed_at: string | null
          status_description_id: number | null
          subcategory: string | null
          unit_type: string | null
          updated_at: string
          urgency: string
        }
        Insert: {
          apartment?: string | null
          building_id: number
          category: string
          complaint_id: number
          complaint_status: Database["public"]["Enums"]["complaint_status"]
          ingested_at?: string
          is_duplicate?: boolean
          problem_code?: string | null
          problem_id: number
          problem_status: Database["public"]["Enums"]["complaint_status"]
          received_at: string
          season?: number | null
          source_updated_at: string
          space_type?: string | null
          status_changed_at?: string | null
          status_description_id?: number | null
          subcategory?: string | null
          unit_type?: string | null
          updated_at?: string
          urgency: string
        }
        Update: {
          apartment?: string | null
          building_id?: number
          category?: string
          complaint_id?: number
          complaint_status?: Database["public"]["Enums"]["complaint_status"]
          ingested_at?: string
          is_duplicate?: boolean
          problem_code?: string | null
          problem_id?: number
          problem_status?: Database["public"]["Enums"]["complaint_status"]
          received_at?: string
          season?: number | null
          source_updated_at?: string
          space_type?: string | null
          status_changed_at?: string | null
          status_description_id?: number | null
          subcategory?: string | null
          unit_type?: string | null
          updated_at?: string
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "complaints_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "complaints_category_fkey"
            columns: ["category"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "complaints_status_description_id_fkey"
            columns: ["status_description_id"]
            isOneToOne: false
            referencedRelation: "status_descriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      ingest_cursors: {
        Row: {
          row_id: string | null
          saved_at: string
          source: string
          updated_at: string
        }
        Insert: {
          row_id?: string | null
          saved_at?: string
          source: string
          updated_at: string
        }
        Update: {
          row_id?: string | null
          saved_at?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      ingest_rejects: {
        Row: {
          created_at: string
          id: number
          payload: Json
          reason: string
          run_id: number
          source_key: string | null
        }
        Insert: {
          created_at?: string
          id?: never
          payload: Json
          reason: string
          run_id: number
          source_key?: string | null
        }
        Update: {
          created_at?: string
          id?: never
          payload?: Json
          reason?: string
          run_id?: number
          source_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingest_rejects_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ingest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ingest_runs: {
        Row: {
          enriched: number | null
          error: string | null
          finished_at: string | null
          id: number
          newest_received_at: string | null
          newest_source_update: string | null
          registry_error: string | null
          rows_fetched: number
          rows_rejected: number
          rows_remaining: number | null
          rows_upserted: number
          source: string
          started_at: string
          status: Database["public"]["Enums"]["ingest_status"]
          watermark_from: string | null
        }
        Insert: {
          enriched?: number | null
          error?: string | null
          finished_at?: string | null
          id?: never
          newest_received_at?: string | null
          newest_source_update?: string | null
          registry_error?: string | null
          rows_fetched?: number
          rows_rejected?: number
          rows_remaining?: number | null
          rows_upserted?: number
          source: string
          started_at?: string
          status?: Database["public"]["Enums"]["ingest_status"]
          watermark_from?: string | null
        }
        Update: {
          enriched?: number | null
          error?: string | null
          finished_at?: string | null
          id?: never
          newest_received_at?: string | null
          newest_source_update?: string | null
          registry_error?: string | null
          rows_fetched?: number
          rows_rejected?: number
          rows_remaining?: number | null
          rows_upserted?: number
          source?: string
          started_at?: string
          status?: Database["public"]["Enums"]["ingest_status"]
          watermark_from?: string | null
        }
        Relationships: []
      }
      resident_reports: {
        Row: {
          apartment: string | null
          building_id: number
          category: string
          created_at: string
          description: string
          id: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["report_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          apartment?: string | null
          building_id: number
          category: string
          created_at?: string
          description: string
          id?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          updated_at?: string
          user_id?: string
        }
        Update: {
          apartment?: string | null
          building_id?: number
          category?: string
          created_at?: string
          description?: string
          id?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resident_reports_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "resident_reports_category_fkey"
            columns: ["category"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["name"]
          },
        ]
      }
      status_descriptions: {
        Row: {
          closure_reason: Database["public"]["Enums"]["closure_reason"]
          description: string
          id: number
          status: Database["public"]["Enums"]["complaint_status"]
        }
        Insert: {
          closure_reason: Database["public"]["Enums"]["closure_reason"]
          description: string
          id?: never
          status: Database["public"]["Enums"]["complaint_status"]
        }
        Update: {
          closure_reason?: Database["public"]["Enums"]["closure_reason"]
          description?: string
          id?: never
          status?: Database["public"]["Enums"]["complaint_status"]
        }
        Relationships: []
      }
      watchlist: {
        Row: {
          building_id: number
          created_at: string
          relationship: Database["public"]["Enums"]["watch_relationship"]
          user_id: string
        }
        Insert: {
          building_id: number
          created_at?: string
          relationship?: Database["public"]["Enums"]["watch_relationship"]
          user_id?: string
        }
        Update: {
          building_id?: number
          created_at?: string
          relationship?: Database["public"]["Enums"]["watch_relationship"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["building_id"]
          },
        ]
      }
    }
    Views: {
      data_freshness: {
        Row: {
          city_last_updated: string | null
          last_successful_sync: string | null
          newest_complaint: string | null
        }
        Relationships: []
      }
      source_status: {
        Row: {
          endpoint: string | null
          label: string | null
          last_caught_up_at: string | null
          last_contact_at: string | null
          last_error: string | null
          last_run_at: string | null
          last_status: string | null
          queued_batches: number | null
          rows_remaining: number | null
          source: string | null
          state: string | null
          streak_runs: number | null
          streak_since: string | null
          synced_through: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_dashboard: {
        Args: { p_days?: number }
        Returns: Json
      }
      is_admin: {
        Args: never
        Returns: boolean
      }
      begin_ingest_run: {
        Args: { p_source?: string }
        Returns: {
          cursor_row_id: string
          run_id: number
          watermark_from: string
        }[]
      }
      borough_code: {
        Args: { b: Database["public"]["Enums"]["borough"] }
        Returns: string
      }
      category_summary: {
        Args: { p_season?: number }
        Returns: {
          buildings: number
          category: string
          complaints: number
          open_complaints: number
        }[]
      }
      classify_closure: {
        Args: {
          description: string
          status: Database["public"]["Enums"]["complaint_status"]
        }
        Returns: Database["public"]["Enums"]["closure_reason"]
      }
      current_season: { Args: never; Returns: number }
      enrich_buildings_from_registry: {
        Args: { p_rows: Json }
        Returns: number
      }
      finish_ingest_run: {
        Args: {
          p_enriched?: number
          p_error?: string
          p_registry_error?: string
          p_rows_remaining?: number
          p_run_id: number
          p_status?: Database["public"]["Enums"]["ingest_status"]
        }
        Returns: undefined
      }
      heat_season: { Args: { ts: string }; Returns: number }
      ingest_hpd_batch: {
        Args: { p_rows: Json; p_run_id: number }
        Returns: Json
      }
      make_bbl: {
        Args: {
          b: Database["public"]["Enums"]["borough"]
          block: string
          lot: string
        }
        Returns: string
      }
      map_buildings: {
        Args: {
          p_category?: string
          p_limit?: number
          p_open_only?: boolean
          p_season?: number
        }
        Returns: {
          address: string
          building_id: number
          complaints: number
          latitude: number
          longitude: number
          open_complaints: number
        }[]
      }
      search_buildings: {
        Args: { max_results?: number; q: string }
        Returns: {
          address: string
          borough: Database["public"]["Enums"]["borough"]
          building_id: number
          complaints_this_season: number
          open_complaints: number
          postcode: string
          similarity: number
        }[]
      }
      top_buildings: {
        Args: {
          p_category?: string
          p_limit?: number
          p_season?: number
          p_sort?: string
        }
        Returns: {
          address: string
          borough: Database["public"]["Enums"]["borough"]
          building_id: number
          complaint_days: number
          complaints: number
          nta: string
          open_complaints: number
        }[]
      }
    }
    Enums: {
      alert_kind: "new_complaint" | "complaint_closed" | "new_report"
      borough: "MANHATTAN" | "BRONX" | "BROOKLYN" | "QUEENS" | "STATEN ISLAND"
      closure_reason:
        | "still_open"
        | "reported_fixed"
        | "no_access"
        | "no_violation"
        | "violation_issued"
        | "other"
      complaint_status: "OPEN" | "CLOSE"
      ingest_status:
        | "running"
        | "succeeded"
        | "partial"
        | "upstream_down"
        | "failed"
      report_status: "open" | "resolved"
      watch_relationship: "live_here" | "considering" | "organizing"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      alert_kind: ["new_complaint", "complaint_closed", "new_report"],
      borough: ["MANHATTAN", "BRONX", "BROOKLYN", "QUEENS", "STATEN ISLAND"],
      closure_reason: [
        "still_open",
        "reported_fixed",
        "no_access",
        "no_violation",
        "violation_issued",
        "other",
      ],
      complaint_status: ["OPEN", "CLOSE"],
      ingest_status: ["running", "succeeded", "partial", "upstream_down", "failed"],
      report_status: ["open", "resolved"],
      watch_relationship: ["live_here", "considering", "organizing"],
    },
  },
} as const
