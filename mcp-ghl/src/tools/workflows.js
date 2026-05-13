import { z } from "zod";
import { ghl, getDefaultLocationId } from "../ghl.js";

const LocationId = z
  .string()
  .optional()
  .describe("GHL sub-account ID. Defaults to env GHL_LOCATION_ID.");

function loc(input) {
  return input.locationId || getDefaultLocationId();
}

export const workflowTools = [
  {
    name: "ghl_workflows_list",
    description: "List all workflows in the location.",
    schema: z.object({ locationId: LocationId }),
    async handler(input) {
      return ghl({
        method: "GET",
        path: "/workflows/",
        query: { locationId: loc(input) },
      });
    },
  },
  {
    name: "ghl_workflow_add_contact",
    description: "Enrol a contact into a workflow.",
    schema: z.object({
      workflowId: z.string(),
      contactId: z.string(),
      eventStartTime: z
        .string()
        .optional()
        .describe("ISO 8601 — when to start the workflow (default: now)"),
    }),
    async handler({ contactId, workflowId, eventStartTime }) {
      return ghl({
        method: "POST",
        path: `/contacts/${contactId}/workflow/${workflowId}`,
        body: { eventStartTime },
      });
    },
  },
  {
    name: "ghl_workflow_remove_contact",
    description: "Remove a contact from a workflow.",
    schema: z.object({ workflowId: z.string(), contactId: z.string() }),
    async handler({ contactId, workflowId }) {
      return ghl({
        method: "DELETE",
        path: `/contacts/${contactId}/workflow/${workflowId}`,
      });
    },
  },
  {
    name: "ghl_forms_list",
    description: "List forms configured in the location.",
    schema: z.object({ locationId: LocationId }),
    async handler(input) {
      return ghl({
        method: "GET",
        path: "/forms/",
        query: { locationId: loc(input) },
      });
    },
  },
  {
    name: "ghl_form_submissions",
    description: "List submissions for a form (paged).",
    schema: z.object({
      formId: z.string().optional(),
      contactId: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional().default(20),
      locationId: LocationId,
    }),
    async handler(input) {
      return ghl({
        method: "GET",
        path: "/forms/submissions",
        query: {
          locationId: loc(input),
          formId: input.formId,
          contactId: input.contactId,
          limit: input.limit,
        },
      });
    },
  },
];
