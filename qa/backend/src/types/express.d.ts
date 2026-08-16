import type { Request } from "express";

export interface AuthUser {
  id: string;
  organizationId: string;
  email: string;
  role: string; // global org role
}

export interface ProjectContext {
  id: string;
  role: string; // effective project role (owner|qa_lead|tester|developer|viewer)
  key: string;
}

export interface AuthedRequest extends Request {
  user: AuthUser;
  requestId: string;
  project?: ProjectContext;
  apiKey?: { id: string; organizationId: string; projectId: string | null; scopes: string[] };
}
