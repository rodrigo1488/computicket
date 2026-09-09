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
  status: "in_progress" | "completed" | "cancelled";
  notes: string;
  overdue: boolean;
  due_at?: string | null;
  due_label?: string | null;
  due_at_label?: string | null;
  entered_at_label?: string | null;
  created_at_label?: string | null;
  created_by_name?: string | null;
};

export type ImplantationLog = {
  id: number;
  step_id: number;
  step_name: string;
  entered_at_label?: string | null;
  due_at_label?: string | null;
  completed_at_label?: string | null;
  overdue: boolean;
};

export type ImplantationDetail = ImplantationCard & {
  logs?: ImplantationLog[];
};

export type KanbanColumn = {
  id: number | null;
  key: string;
  name: string;
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
