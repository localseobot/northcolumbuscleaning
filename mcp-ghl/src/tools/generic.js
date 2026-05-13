import { z } from "zod";
import { ghl } from "../ghl.js";

export const genericTools = [
  {
    name: "ghl_request",
    description:
      "Escape hatch: call any GHL v2 API endpoint directly. Use this for endpoints not covered by the typed tools (payments, products, media, social planner, blogs, snapshots, SaaS, businesses, surveys, campaigns, links, OAuth, etc.). Reference: https://highlevel.stoplight.io/docs/integrations/",
    schema: z.object({
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      path: z
        .string()
        .describe("Endpoint path beginning with '/', e.g. /products/"),
      query: z
        .record(z.any())
        .optional()
        .describe("Query-string params as a flat object"),
      body: z
        .any()
        .optional()
        .describe("JSON body for non-GET requests"),
      version: z
        .string()
        .optional()
        .describe(
          "Version header override. Default 2021-07-28. Payments endpoints often need 2021-04-15.",
        ),
    }),
    async handler(input) {
      return ghl(input);
    },
  },
];
