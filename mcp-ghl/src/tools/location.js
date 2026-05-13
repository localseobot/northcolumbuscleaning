import { z } from "zod";
import { ghl, getDefaultLocationId } from "../ghl.js";

const LocationId = z
  .string()
  .optional()
  .describe("GHL sub-account ID. Defaults to env GHL_LOCATION_ID.");

function loc(input) {
  return input.locationId || getDefaultLocationId();
}

export const locationTools = [
  {
    name: "ghl_location_get",
    description: "Get sub-account (location) details.",
    schema: z.object({ locationId: LocationId }),
    async handler(input) {
      return ghl({ method: "GET", path: `/locations/${loc(input)}` });
    },
  },
  {
    name: "ghl_location_tags",
    description: "List all tags configured for the location.",
    schema: z.object({ locationId: LocationId }),
    async handler(input) {
      return ghl({
        method: "GET",
        path: `/locations/${loc(input)}/tags`,
      });
    },
  },
  {
    name: "ghl_location_custom_fields",
    description: "List custom field definitions for the location.",
    schema: z.object({
      locationId: LocationId,
      model: z
        .enum(["contact", "opportunity", "all"])
        .optional()
        .describe("Filter by model type"),
    }),
    async handler(input) {
      return ghl({
        method: "GET",
        path: `/locations/${loc(input)}/customFields`,
        query: { model: input.model },
      });
    },
  },
  {
    name: "ghl_location_custom_values",
    description: "List custom values (location-level variables) for the location.",
    schema: z.object({ locationId: LocationId }),
    async handler(input) {
      return ghl({
        method: "GET",
        path: `/locations/${loc(input)}/customValues`,
      });
    },
  },
  {
    name: "ghl_users_list",
    description: "List staff users in the location.",
    schema: z.object({ locationId: LocationId }),
    async handler(input) {
      return ghl({
        method: "GET",
        path: "/users/",
        query: { locationId: loc(input) },
      });
    },
  },
  {
    name: "ghl_user_get",
    description: "Get a user by ID.",
    schema: z.object({ userId: z.string() }),
    async handler({ userId }) {
      return ghl({ method: "GET", path: `/users/${userId}` });
    },
  },
];
