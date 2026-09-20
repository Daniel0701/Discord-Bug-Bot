export interface Env {
  DISCORD_APPLICATION_ID: string;
  DISCORD_PUBLIC_KEY: string;
  NOTION_TOKEN: string;
  NOTION_DATA_SOURCE_ID: string;
  ADVANCED_PERMS_ROLE_IDS?: string;
  ADVANCED_PERMS_USER_IDS?: string;
  NOTION_BUG_NUMBER_PROPERTY?: string;
  NOTION_TASK_PROPERTY?: string;
  NOTION_TITLE_PROPERTY?: string;
  NOTION_DESCRIPTION_PROPERTY?: string;
  NOTION_VIDEO_URL_PROPERTY?: string;
  NOTION_TEAM_PROPERTY?: string;
  NOTION_PRIORITY_PROPERTY?: string;
  NOTION_ASSIGNEE_PROPERTY?: string;
  NOTION_DUE_DATE_PROPERTY?: string;
  NOTION_SCOPE_PROPERTY?: string;
  NOTION_SCOPE_VALUE?: string;
  NOTION_SCOPE_TYPE?: "select" | "multi_select";
  NOTION_STATUS_PROPERTY?: string;
  NOTION_STATUS_TYPE?: "status" | "select" | "checkbox";
  NOTION_DONE_STATUS?: string;
  NOTION_REVIEW_STATUS?: string;
  NOTION_COMPLETE_STATUS?: string;
  SEARCH_MATCH_THRESHOLD?: string;
  SEARCH_CANDIDATE_LIMIT?: string;
  RANDOM_PRIORITY_ORDER?: string;
  RANDOM_EXCLUDED_STATUSES?: string;
  REPORT_RATE_LIMITER?: RateLimit;
}

export interface BugRecord {
  pageId: string;
  number: number;
  title: string;
  description: string;
  team: string;
  priority: string;
  status: string;
  url: string;
  videoUrl?: string;
  dueDate?: string;
}

export interface SearchResult {
  bug: BugRecord;
  score: number;
  reasons: string[];
}

export interface NotionOptionProperty {
  type: "select" | "multi_select" | "status";
  options: string[];
}

export interface CreateBugInput {
  number: number;
  team: string;
  priority: string;
  description: string;
  videoUrl: string;
}

export interface NotionUser {
  id: string;
  name: string;
}

export interface DiscordInteraction {
  id: string;
  application_id: string;
  type: number;
  token: string;
  data?: {
    name: string;
    options?: DiscordOption[];
  };
  member?: {
    roles?: string[];
    permissions?: string;
    user?: { id: string; username?: string; global_name?: string };
  };
  user?: { id: string; username?: string; global_name?: string };
}

export interface DiscordOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: DiscordOption[];
}
