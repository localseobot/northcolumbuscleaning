// Retell AI custom tool — check whether a U.S. zip is in our service area.
// The voice agent calls this mid-conversation when a caller mentions
// a zip or unfamiliar city.

// Retell function calls arrive as POST with body:
//   { call: {...}, name: "check_service_area", args: { zip: "43085" } }
// Response should be JSON the agent can use verbally.

export const config = { runtime: "nodejs" };

// Keep this in sync with the neighborhood list in scripts/generate-pages.py
const SERVICE_ZIPS = {
  "43085": "Worthington",
  "43235": "Worthington",
  "43202": "Clintonville",
  "43214": "Clintonville",
  "43224": "Clintonville",
  "43081": "Westerville",
  "43082": "Westerville",
  "43086": "Westerville",
  "43016": "Dublin",
  "43017": "Dublin",
  "43054": "New Albany",
  "43065": "Powell",
  "43220": "Upper Arlington",
  "43221": "Upper Arlington",
  "43230": "Gahanna",
  "43240": "Polaris",
  "43035": "Lewis Center",
  "43015": "Delaware",
  "43026": "Hilliard",
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  }

  const args = body?.args || {};
  const zipRaw = String(args.zip || "").trim();
  const zip = zipRaw.slice(0, 5);

  if (!/^\d{5}$/.test(zip)) {
    return res.status(200).json({
      result: `I couldn't parse a 5-digit zip from '${zipRaw}'. Could you read it back one digit at a time?`,
    });
  }

  const neighborhood = SERVICE_ZIPS[zip];
  if (neighborhood) {
    return res.status(200).json({
      result: `Yes, ${zip} is in our service area — that's ${neighborhood}.`,
      served: true,
      neighborhood,
      zip,
    });
  }

  return res.status(200).json({
    result: `${zip} isn't in our current service area, but I can still take the details and the team can see if it's a fit.`,
    served: false,
    zip,
  });
}
