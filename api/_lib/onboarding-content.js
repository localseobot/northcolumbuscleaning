// Single source of truth for onboarding copy: the contractor agreement (shown
// on the page AND baked verbatim into the signed PDF) and the onboarding
// document / checklist the contractor must review.
//
// NOTE: This agreement is a practical template, not legal advice. Have counsel
// review AGREEMENT_TEXT before relying on it. Bump AGREEMENT_VERSION whenever
// the text changes so signed PDFs record which version was accepted.

export const AGREEMENT_VERSION = "2026-06-v1";
export const AGREEMENT_TITLE = "Independent Contractor Agreement";

export const AGREEMENT_TEXT = `This Independent Contractor Agreement ("Agreement") is entered into between North Columbus Cleaning Company ("Company") and the undersigned contractor ("Contractor") as of the date of signature below.

1. RELATIONSHIP OF THE PARTIES. Contractor is an independent contractor, not an employee, partner, or agent of Company. Contractor is responsible for their own federal, state, and local taxes, including self-employment tax. Company will not withhold taxes and will report payments on IRS Form 1099 where required. Nothing in this Agreement creates an employment, joint-venture, or partnership relationship.

2. SERVICES. Contractor will perform residential and/or commercial cleaning services as assigned and accepted through Company's scheduling system. Contractor will perform services in a professional, workmanlike manner consistent with Company's published cleaning checklists and quality standards.

3. SCHEDULING AND ACCEPTANCE. Contractor may accept or decline assignments. Once an assignment is accepted, Contractor agrees to complete it as scheduled or to provide reasonable advance notice if unable to do so.

4. SUPPLIES AND EQUIPMENT. Unless otherwise agreed in writing, Contractor will supply their own basic equipment. Company may provide certain specialized products or branded materials, which remain Company property.

5. COMPENSATION. Company will pay Contractor the agreed per-job or hourly rate communicated at assignment. Payment is made on Company's regular pay cycle following completion and verification of the work.

6. CONDUCT AND CONFIDENTIALITY. Contractor will treat clients, client property, and Company information with care and respect. Contractor will keep confidential all client information, access codes, and Company business information, during and after the term of this Agreement. Contractor will not solicit Company's clients for competing services for twelve (12) months after this Agreement ends.

7. BACKGROUND AND ELIGIBILITY. Contractor represents that they are legally authorized to work and to provide the services, and consents to reasonable background screening as permitted by law.

8. INSURANCE AND LIABILITY. Contractor is responsible for damage or loss caused by Contractor's negligence or willful misconduct. Contractor agrees to promptly report any incident, breakage, or client concern to Company.

9. TERM AND TERMINATION. Either party may terminate this Agreement at any time, with or without cause, upon written notice. Sections relating to confidentiality, non-solicitation, and payment for completed work survive termination.

10. INDEMNIFICATION. Contractor agrees to indemnify and hold Company harmless from claims arising out of Contractor's negligence, willful misconduct, or breach of this Agreement.

11. ENTIRE AGREEMENT. This Agreement is the entire agreement between the parties regarding its subject matter and may be amended only in writing. It is governed by the laws of the State of Ohio.

By signing below, Contractor acknowledges that they have read, understood, and agree to be bound by this Agreement, and that signing electronically has the same legal effect as a handwritten signature.`;

export const ONBOARDING_DOC_TITLE = "Contractor Onboarding & Standards";

// Sections rendered on the page for the contractor to review before confirming.
export const ONBOARDING_DOC_SECTIONS = [
  {
    heading: "Welcome",
    body: "Welcome to the North Columbus Cleaning team! This page gets you set up to take jobs. Please review everything below carefully — confirming means you understand how we work and what clients expect.",
  },
  {
    heading: "Quality standards",
    body: "Every job follows our published room-by-room checklist for the service tier booked (Standard, Deep, or Move-In/Out). Top-to-bottom, left-to-right, nothing skipped. A senior cleaner may spot-check work. Photos before/after are encouraged.",
  },
  {
    heading: "Professionalism",
    body: "Arrive within the scheduled window, in clean attire. Be courteous and respectful in every home. Never touch valuables, mail, or personal documents. If something is broken or a client raises a concern, report it to the office immediately — do not leave it unaddressed.",
  },
  {
    heading: "Access & security",
    body: "Treat gate codes, lockbox codes, and keys as strictly confidential. Never share client addresses or access info with anyone. Lock up when you leave exactly as instructed.",
  },
  {
    heading: "Scheduling & communication",
    body: "Accept or decline jobs promptly. If you must cancel, give as much notice as possible so we can cover the client. Keep your phone reachable during your scheduled window.",
  },
  {
    heading: "Getting paid",
    body: "Payment follows completion and verification on our regular pay cycle. You are an independent contractor responsible for your own taxes — that's why we collect your W-9.",
  },
];

// The checklist the contractor confirms they have reviewed.
export const REVIEW_CHECKLIST = [
  "I have reviewed the room-by-room cleaning checklist for each service tier.",
  "I understand the professionalism and client-conduct expectations.",
  "I understand that access codes and client information are confidential.",
  "I understand the scheduling, cancellation, and communication expectations.",
  "I understand I am an independent contractor responsible for my own taxes.",
];

export const TAX_CLASSIFICATIONS = [
  "Individual/sole proprietor",
  "Single-member LLC",
  "C Corporation",
  "S Corporation",
  "Partnership",
  "LLC (C corporation)",
  "LLC (S corporation)",
  "LLC (Partnership)",
  "Trust/estate",
  "Other",
];
