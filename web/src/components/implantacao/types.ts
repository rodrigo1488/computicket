export type DurationUnit = "hours" | "days";

export type ImplantationSystem = {
  id: number;
  name: string;
  description?: string;
  version?: string;
  company?: string;
  is_active?: boolean;
};

export type ImplantationStep = {
  id: number;
  model_id: number;
  name: string;
  description?: string;
  position: number;
  duration_value: number;
  duration_unit: DurationUnit;
  duration_label: string;
  is_active: boolean;
};

export type ImplantationModel = {
  id: number;
  name: string;
  description: string;
  system_id: number;
  system_name: string;
  system?: ImplantationSystem | null;
  is_active: boolean;
  steps_count: number;
  active_count: number;
  steps?: ImplantationStep[];
};

export type ImplantationLog = {
  id: number;
  step_id: number;
  step_name: string;
  entered_at_label?: string | null;
  due_at_label?: string | null;
  completed_at_label?: string | null;
  overdue: boolean;
  assignee_id?: number | null;
  assignee_name?: string | null;
  ticket_id?: number | null;
};

export type ImplantationCard = {
  id: number;
  external_client_id: number;
  external_client_name: string;
  model_id: number;
  model_name: string;
  system_id?: number | null;
  system_name: string;
  current_step_id: number | null;
  current_step_name: string;
  status: "in_progress" | "paused" | "completed" | "cancelled";
  notes: string;
  overdue: boolean;
  due_at?: string | null;
  due_label?: string | null;
  due_at_label?: string | null;
  paused_at?: string | null;
  paused_at_label?: string | null;
  paused_days?: number;
  paused_long?: boolean;
  paused_for_label?: string | null;
  entered_at_label?: string | null;
  created_at_label?: string | null;
  created_by_name?: string | null;
  assigned_to_id?: number | null;
  assigned_to_name?: string | null;
  step_assignee_id?: number | null;
  step_assignee_name?: string | null;
  current_assignee_id?: number | null;
  current_assignee_name?: string | null;
  ticket_id?: number | null;
  next_step_id?: number | null;
  next_step_name?: string | null;
  scheduled_appointment_id?: number | null;
  scheduled_step_id?: number | null;
  scheduled_step_name?: string | null;
  scheduled_at?: string | null;
  scheduled_at_label?: string | null;
  alert?: "overdue" | "paused_long" | "paused" | "ok" | "completed" | "cancelled";
};

export type ImplantationDetail = ImplantationCard & {
  logs?: ImplantationLog[];
};

export type ImplantationDashboard = {
  kpis: {
    in_progress: number;
    paused: number;
    overdue: number;
    paused_long: number;
    completed_recent?: number;
  };
  items: ImplantationCard[];
};

export type KanbanColumn = {
  id: number | null;
  key: string;
  name: string;
  description?: string | null;
  duration_label?: string | null;
  cards: ImplantationCard[];
};

export type KanbanBoardData = {
  model: ImplantationModel;
  columns: KanbanColumn[];
  overdue_count: number;
  total: number;
};

export const COMPLETED_COLUMN_KEY = "completed";
