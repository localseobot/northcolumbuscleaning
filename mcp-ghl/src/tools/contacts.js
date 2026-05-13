import { z } from "zod";
import { ghl, getDefaultLocationId } from "../ghl.js";

const LocationId = z
  .string()
  .optional()
  .describe("GHL sub-account ID. Defaults to env GHL_LOCATION_ID.");

const ContactFields = {
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  name: z.string().optional().describe("Full name; used if first/last omitted"),
  email: z.string().email().optional(),
  phone: z.string().optional().describe("E.164 preferred, e.g. +16145551234"),
  address1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  companyName: z.string().optional(),
  website: z.string().optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
  customFields: z
    .array(z.object({ id: z.string(), value: z.any() }))
    .optional()
    .describe("Array of {id, value} for custom field values"),
};

function loc(input) {
  return input.locationId || getDefaultLocationId();
}

export const contactTools = [
  {
    name: "ghl_contact_search",
    description:
      "Search contacts by free-text query (name/email/phone). Returns paged list.",
    schema: z.object({
      query: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional().default(20),
      locationId: LocationId,
    }),
    async handler(input) {
      return ghl({
        method: "GET",
        path: "/contacts/",
        query: {
          locationId: loc(input),
          query: input.query,
          limit: input.limit,
        },
      });
    },
  },
  {
    name: "ghl_contact_get",
    description: "Get a contact by ID, with custom fields and tags.",
    schema: z.object({ contactId: z.string() }),
    async handler({ contactId }) {
      return ghl({ method: "GET", path: `/contacts/${contactId}` });
    },
  },
  {
    name: "ghl_contact_create",
    description: "Create a new contact in the GHL sub-account.",
    schema: z.object({ ...ContactFields, locationId: LocationId }),
    async handler(input) {
      const { locationId: _drop, ...fields } = input;
      return ghl({
        method: "POST",
        path: "/contacts/",
        body: { locationId: loc(input), ...fields },
      });
    },
  },
  {
    name: "ghl_contact_update",
    description: "Update fields on an existing contact.",
    schema: z.object({ contactId: z.string(), ...ContactFields }),
    async handler({ contactId, ...fields }) {
      return ghl({
        method: "PUT",
        path: `/contacts/${contactId}`,
        body: fields,
      });
    },
  },
  {
    name: "ghl_contact_upsert",
    description:
      "Create or update a contact, matched by email or phone. Useful when you don't know if the contact exists yet.",
    schema: z.object({ ...ContactFields, locationId: LocationId }),
    async handler(input) {
      const { locationId: _drop, ...fields } = input;
      return ghl({
        method: "POST",
        path: "/contacts/upsert",
        body: { locationId: loc(input), ...fields },
      });
    },
  },
  {
    name: "ghl_contact_delete",
    description: "Permanently delete a contact. Cannot be undone.",
    schema: z.object({ contactId: z.string() }),
    async handler({ contactId }) {
      return ghl({ method: "DELETE", path: `/contacts/${contactId}` });
    },
  },
  {
    name: "ghl_contact_add_tags",
    description: "Add one or more tags to a contact.",
    schema: z.object({
      contactId: z.string(),
      tags: z.array(z.string()).min(1),
    }),
    async handler({ contactId, tags }) {
      return ghl({
        method: "POST",
        path: `/contacts/${contactId}/tags`,
        body: { tags },
      });
    },
  },
  {
    name: "ghl_contact_remove_tags",
    description: "Remove one or more tags from a contact.",
    schema: z.object({
      contactId: z.string(),
      tags: z.array(z.string()).min(1),
    }),
    async handler({ contactId, tags }) {
      return ghl({
        method: "DELETE",
        path: `/contacts/${contactId}/tags`,
        body: { tags },
      });
    },
  },
  {
    name: "ghl_contact_notes_list",
    description: "List notes attached to a contact.",
    schema: z.object({ contactId: z.string() }),
    async handler({ contactId }) {
      return ghl({ method: "GET", path: `/contacts/${contactId}/notes` });
    },
  },
  {
    name: "ghl_contact_note_create",
    description: "Add a free-text note to a contact.",
    schema: z.object({
      contactId: z.string(),
      body: z.string(),
      userId: z.string().optional(),
    }),
    async handler({ contactId, body, userId }) {
      return ghl({
        method: "POST",
        path: `/contacts/${contactId}/notes`,
        body: { body, userId },
      });
    },
  },
  {
    name: "ghl_contact_tasks_list",
    description: "List tasks attached to a contact.",
    schema: z.object({ contactId: z.string() }),
    async handler({ contactId }) {
      return ghl({ method: "GET", path: `/contacts/${contactId}/tasks` });
    },
  },
  {
    name: "ghl_contact_task_create",
    description: "Create a task on a contact (optional due date and assignee).",
    schema: z.object({
      contactId: z.string(),
      title: z.string(),
      body: z.string().optional(),
      dueDate: z.string().optional().describe("ISO 8601 timestamp"),
      assignedTo: z.string().optional().describe("User ID"),
    }),
    async handler({ contactId, ...rest }) {
      return ghl({
        method: "POST",
        path: `/contacts/${contactId}/tasks`,
        body: rest,
      });
    },
  },
];
