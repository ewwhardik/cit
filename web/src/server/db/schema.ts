/**
 * Database schema (Drizzle, Postgres).
 *
 * Auth tables follow Better Auth's core schema; app tables follow PLAN.md §3.1.
 * Schedules, reports and requests are stored as JSONB in the starter-pack
 * format so the engine can consume them directly.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["admin", "dept_coordinator", "faculty", "club"]);
export type Role = (typeof roleEnum.enumValues)[number];

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------- auth (Better Auth)
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: roleEnum("role").notNull().default("faculty"),
  department: text("department"),
  facultyId: text("faculty_id"),
  clubName: text("club_name"),
  ...timestamps,
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  ...timestamps,
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  ...timestamps,
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

// ---------------------------------------------------------------- app
export const datasets = pgTable("datasets", {
  id: serial("id").primaryKey(),
  datasetId: text("dataset_id").notNull(),
  json: jsonb("json").notNull(),
  uploadedBy: text("uploaded_by").references(() => user.id),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const disruptionStatusEnum = pgEnum("disruption_status", [
  "uploaded",
  "proposed",
  "applied",
  "rejected",
]);

export const disruptions = pgTable("disruptions", {
  id: serial("id").primaryKey(),
  datasetRef: integer("dataset_ref")
    .notNull()
    .references(() => datasets.id, { onDelete: "cascade" }),
  json: jsonb("json").notNull(),
  status: disruptionStatusEnum("status").notNull().default("uploaded"),
  uploadedBy: text("uploaded_by").references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const versionKindEnum = pgEnum("version_kind", ["base", "proposal", "applied"]);

/** A full schedule.json document plus its checker report. */
export const timetableVersions = pgTable(
  "timetable_versions",
  {
    id: serial("id").primaryKey(),
    datasetRef: integer("dataset_ref")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    kind: versionKindEnum("kind").notNull(),
    parentId: integer("parent_id"),
    schedule: jsonb("schedule").notNull(),
    report: jsonb("report").notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
    createdBy: text("created_by").references(() => user.id),
    approvedBy: text("approved_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("timetable_versions_current_idx").on(t.datasetRef, t.isCurrent)],
);

export const requestStatusEnum = pgEnum("request_status", [
  "pending",
  "approved",
  "rejected",
  "alternative_offered",
  "cancelled",
]);
export const parsedByEnum = pgEnum("parsed_by", ["llm", "fallback", "manual", "dataset"]);

export const bookingRequests = pgTable("booking_requests", {
  id: serial("id").primaryKey(),
  requestId: text("request_id").notNull().unique(),
  source: text("source").notNull().default("app"),
  requesterUserId: text("requester_user_id").references(() => user.id),
  payload: jsonb("payload").notNull(),
  rawText: text("raw_text"),
  parsedBy: parsedByEnum("parsed_by").notNull().default("manual"),
  status: requestStatusEnum("status").notNull().default("pending"),
  decision: jsonb("decision"),
  reason: text("reason"),
  decidedBy: text("decided_by").references(() => user.id),
  ...timestamps,
});

export const proposalTypeEnum = pgEnum("proposal_type", [
  "disruption",
  "ai_change",
  "manual",
  "booking_override",
]);
export const proposalStatusEnum = pgEnum("proposal_status", ["pending", "approved", "rejected"]);

/** Anything that would change the timetable waits here for an approver. */
export const proposals = pgTable(
  "proposals",
  {
    id: serial("id").primaryKey(),
    type: proposalTypeEnum("type").notNull(),
    title: text("title").notNull(),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id),
    datasetRef: integer("dataset_ref")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    baseVersionId: integer("base_version_id").references(() => timetableVersions.id),
    disruptionId: integer("disruption_id").references(() => disruptions.id),
    diff: jsonb("diff").notNull(),
    /** Change file applied to the dataset when the proposal is approved (may be empty). */
    changes: jsonb("changes").notNull().default({ changes: [] }),
    summary: jsonb("summary"),
    schedule: jsonb("schedule").notNull(),
    validation: jsonb("validation").notNull(),
    explanation: text("explanation"),
    status: proposalStatusEnum("status").notNull().default("pending"),
    approvedBy: text("approved_by").references(() => user.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Separation of duties: nobody approves their own request.
  (t) => [
    check("proposals_no_self_approval", sql`${t.approvedBy} IS NULL OR ${t.approvedBy} <> ${t.requestedBy}`),
  ],
);

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  actor: text("actor").references(() => user.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  engineJobId: text("engine_job_id").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("running"),
  datasetRef: integer("dataset_ref").references(() => datasets.id, { onDelete: "cascade" }),
  meta: jsonb("meta"),
  createdBy: text("created_by").references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
