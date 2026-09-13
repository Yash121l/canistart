export interface ApiUser {
  login: string;
}

export interface ApiIssue {
  number: number;
  title: string;
  html_url: string;
  state: string;
  state_reason?: string | null;
  locked: boolean;
  assignees: ApiUser[];
  labels: { name: string }[];
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  body?: string | null;
  user: ApiUser;
  author_association: string;
  pull_request?: { merged_at?: string | null } | null;
}

export interface ApiComment {
  user: ApiUser;
  author_association: string;
  body?: string | null;
  html_url?: string;
}

export interface ApiPull {
  number: number;
  title: string;
  html_url: string;
  state: string;
  draft?: boolean;
  merged_at?: string | null;
  created_at: string;
  closed_at?: string | null;
  user: ApiUser;
  author_association: string;
  body?: string | null;
}

export interface ApiRepo {
  full_name: string;
  html_url: string;
  archived: boolean;
  pushed_at: string;
  open_issues_count: number;
  default_branch: string;
}

export interface ApiTimelineEvent {
  event: string;
  commit_id?: string | null;
  commit_url?: string | null;
  source?: {
    type?: string;
    issue?: {
      number: number;
      html_url: string;
      state: string;
      repository?: { full_name: string };
      pull_request?: { merged_at?: string | null } | null;
    };
  };
}

export interface ApiSearchResult {
  total_count: number;
  items: ApiIssue[];
}

export interface ApiContent {
  path: string;
  html_url: string;
  content: string;
  encoding: string;
}

export interface ApiWorkflowList {
  workflows: { name: string; path: string; html_url: string }[];
}
