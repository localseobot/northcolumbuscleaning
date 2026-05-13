import { z } from "zod";
import { ghl, getDefaultLocationId } from "../ghl.js";

const LocationId = z
  .string()
  .optional()
  .describe("GHL sub-account ID. Defaults to env GHL_LOCATION_ID.");

function loc(input) {
  return input.locationId || getDefaultLocationId();
}

export const calendarTools = [
  {
    name: "ghl_calendar_list",
    description: "List all calendars in the sub-account.",
    schema: z.object({ locationId: LocationId }),
    async handler(input) {
      return ghl({
        method: "GET",
        path: "/calendars/",
        query: { locationId: loc(input) },
      });
    },
  },
  {
    name: "ghl_calendar_get",
    description: "Get a calendar definition by ID.",
    schema: z.object({ calendarId: z.string() }),
    async handler({ calendarId }) {
      return ghl({ method: "GET", path: `/calendars/${calendarId}` });
    },
  },
  {
    name: "ghl_calendar_free_slots",
    description:
      "Get available time slots for a calendar in a date range. Times are returned in the calendar's timezone (or the timezone arg if supplied).",
    schema: z.object({
      calendarId: z.string(),
      startDate: z
        .union([z.string(), z.number()])
        .describe("Epoch ms or ISO 8601"),
      endDate: z
        .union([z.string(), z.number()])
        .describe("Epoch ms or ISO 8601"),
      timezone: z
        .string()
        .optional()
        .describe("IANA tz, e.g. America/New_York"),
      userId: z.string().optional().describe("Filter to one staff user"),
    }),
    async handler({ calendarId, startDate, endDate, timezone, userId }) {
      return ghl({
        method: "GET",
        path: `/calendars/${calendarId}/free-slots`,
        query: {
          startDate: typeof startDate === "string" ? Date.parse(startDate) : startDate,
          endDate: typeof endDate === "string" ? Date.parse(endDate) : endDate,
          timezone,
          userId,
        },
      });
    },
  },
  {
    name: "ghl_appointment_create",
    description: "Book an appointment on a calendar for a contact.",
    schema: z.object({
      calendarId: z.string(),
      contactId: z.string(),
      startTime: z.string().describe("ISO 8601 timestamp"),
      endTime: z.string().optional().describe("ISO 8601 timestamp"),
      title: z.string().optional(),
      appointmentStatus: z
        .enum(["new", "confirmed", "cancelled", "showed", "noshow", "invalid"])
        .optional(),
      assignedUserId: z.string().optional(),
      address: z.string().optional(),
      notes: z.string().optional(),
      locationId: LocationId,
    }),
    async handler(input) {
      const { locationId: _drop, ...rest } = input;
      return ghl({
        method: "POST",
        path: "/calendars/events/appointments",
        body: { locationId: loc(input), ...rest },
      });
    },
  },
  {
    name: "ghl_appointment_get",
    description: "Get a calendar appointment by ID.",
    schema: z.object({ appointmentId: z.string() }),
    async handler({ appointmentId }) {
      return ghl({
        method: "GET",
        path: `/calendars/events/appointments/${appointmentId}`,
      });
    },
  },
  {
    name: "ghl_appointment_update",
    description: "Update an appointment (reschedule, change status, etc.).",
    schema: z.object({
      appointmentId: z.string(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
      title: z.string().optional(),
      appointmentStatus: z
        .enum(["new", "confirmed", "cancelled", "showed", "noshow", "invalid"])
        .optional(),
      assignedUserId: z.string().optional(),
      address: z.string().optional(),
    }),
    async handler({ appointmentId, ...rest }) {
      return ghl({
        method: "PUT",
        path: `/calendars/events/appointments/${appointmentId}`,
        body: rest,
      });
    },
  },
  {
    name: "ghl_appointment_delete",
    description: "Cancel/delete an appointment.",
    schema: z.object({ appointmentId: z.string() }),
    async handler({ appointmentId }) {
      return ghl({
        method: "DELETE",
        path: `/calendars/events/appointments/${appointmentId}`,
      });
    },
  },
];
