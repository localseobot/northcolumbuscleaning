import { z } from "zod";
import { ghl, getDefaultLocationId } from "../ghl.js";

const LocationId = z
  .string()
  .optional()
  .describe("GHL sub-account ID. Defaults to env GHL_LOCATION_ID.");

function loc(input) {
  return input.locationId || getDefaultLocationId();
}

export const opportunityTools = [
  {
    name: "ghl_pipeline_list",
    description: "List all opportunity pipelines (with stages).",
    schema: z.object({ locationId: LocationId }),
    async handler(input) {
      return ghl({
        method: "GET",
        path: "/opportunities/pipelines",
        query: { locationId: loc(input) },
      });
    },
  },
  {
    name: "ghl_opportunity_search",
    description:
      "Search opportunities. Filter by pipeline, stage, status, free-text query, or assignee.",
    schema: z.object({
      pipelineId: z.string().optional(),
      pipelineStageId: z.string().optional(),
      status: z.enum(["open", "won", "lost", "abandoned", "all"]).optional(),
      query: z.string().optional(),
      assignedTo: z.string().optional(),
      contactId: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional().default(20),
      locationId: LocationId,
    }),
    async handler(input) {
      return ghl({
        method: "GET",
        path: "/opportunities/search",
        query: {
          location_id: loc(input),
          pipeline_id: input.pipelineId,
          pipeline_stage_id: input.pipelineStageId,
          status: input.status,
          q: input.query,
          assigned_to: input.assignedTo,
          contact_id: input.contactId,
          limit: input.limit,
        },
      });
    },
  },
  {
    name: "ghl_opportunity_get",
    description: "Get one opportunity by ID.",
    schema: z.object({ opportunityId: z.string() }),
    async handler({ opportunityId }) {
      return ghl({
        method: "GET",
        path: `/opportunities/${opportunityId}`,
      });
    },
  },
  {
    name: "ghl_opportunity_create",
    description: "Create an opportunity in a pipeline stage.",
    schema: z.object({
      pipelineId: z.string(),
      pipelineStageId: z.string(),
      name: z.string(),
      contactId: z.string(),
      monetaryValue: z.number().optional(),
      status: z
        .enum(["open", "won", "lost", "abandoned"])
        .optional()
        .default("open"),
      assignedTo: z.string().optional(),
      source: z.string().optional(),
      locationId: LocationId,
    }),
    async handler(input) {
      const { locationId: _drop, ...rest } = input;
      return ghl({
        method: "POST",
        path: "/opportunities/",
        body: { locationId: loc(input), ...rest },
      });
    },
  },
  {
    name: "ghl_opportunity_update",
    description:
      "Update an opportunity (move stage, change value, mark won/lost, etc.).",
    schema: z.object({
      opportunityId: z.string(),
      pipelineId: z.string().optional(),
      pipelineStageId: z.string().optional(),
      name: z.string().optional(),
      monetaryValue: z.number().optional(),
      status: z.enum(["open", "won", "lost", "abandoned"]).optional(),
      assignedTo: z.string().optional(),
    }),
    async handler({ opportunityId, ...rest }) {
      return ghl({
        method: "PUT",
        path: `/opportunities/${opportunityId}`,
        body: rest,
      });
    },
  },
  {
    name: "ghl_opportunity_delete",
    description: "Delete an opportunity.",
    schema: z.object({ opportunityId: z.string() }),
    async handler({ opportunityId }) {
      return ghl({
        method: "DELETE",
        path: `/opportunities/${opportunityId}`,
      });
    },
  },
];
