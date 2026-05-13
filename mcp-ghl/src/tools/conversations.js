import { z } from "zod";
import { ghl, getDefaultLocationId } from "../ghl.js";

const LocationId = z
  .string()
  .optional()
  .describe("GHL sub-account ID. Defaults to env GHL_LOCATION_ID.");

function loc(input) {
  return input.locationId || getDefaultLocationId();
}

export const conversationTools = [
  {
    name: "ghl_conversation_search",
    description:
      "Search conversations. Filter by contactId, free-text query, status, or assignee.",
    schema: z.object({
      contactId: z.string().optional(),
      query: z.string().optional(),
      status: z.enum(["all", "read", "unread", "starred"]).optional(),
      assignedTo: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional().default(20),
      locationId: LocationId,
    }),
    async handler(input) {
      return ghl({
        method: "GET",
        path: "/conversations/search",
        query: {
          locationId: loc(input),
          contactId: input.contactId,
          query: input.query,
          status: input.status,
          assignedTo: input.assignedTo,
          limit: input.limit,
        },
      });
    },
  },
  {
    name: "ghl_conversation_get",
    description: "Get a conversation by ID.",
    schema: z.object({ conversationId: z.string() }),
    async handler({ conversationId }) {
      return ghl({
        method: "GET",
        path: `/conversations/${conversationId}`,
      });
    },
  },
  {
    name: "ghl_conversation_messages",
    description: "List messages in a conversation, most recent first.",
    schema: z.object({
      conversationId: z.string(),
      limit: z.number().int().min(1).max(100).optional().default(20),
    }),
    async handler({ conversationId, limit }) {
      return ghl({
        method: "GET",
        path: `/conversations/${conversationId}/messages`,
        query: { limit },
      });
    },
  },
  {
    name: "ghl_message_send_sms",
    description:
      "Send an SMS to a contact via the GHL conversations API. Requires the contact to have a phone number on file.",
    schema: z.object({
      contactId: z.string(),
      message: z.string(),
      fromNumber: z
        .string()
        .optional()
        .describe("Optional sender number; defaults to the location default"),
    }),
    async handler({ contactId, message, fromNumber }) {
      return ghl({
        method: "POST",
        path: "/conversations/messages",
        body: { type: "SMS", contactId, message, fromNumber },
      });
    },
  },
  {
    name: "ghl_message_send_email",
    description: "Send an email to a contact via GHL conversations.",
    schema: z.object({
      contactId: z.string(),
      subject: z.string(),
      html: z
        .string()
        .optional()
        .describe("HTML body (preferred). Provide html OR text."),
      text: z.string().optional().describe("Plain-text body."),
      from: z.string().email().optional(),
      replyTo: z.string().email().optional(),
    }),
    async handler({ contactId, subject, html, text, from, replyTo }) {
      return ghl({
        method: "POST",
        path: "/conversations/messages",
        body: {
          type: "Email",
          contactId,
          subject,
          html,
          message: text,
          emailFrom: from,
          emailReplyTo: replyTo,
        },
      });
    },
  },
];
