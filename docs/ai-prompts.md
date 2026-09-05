# AI Prompts and Usage

This project used AI assistance as a development aid while keeping implementation, testing, debugging, and final technical decisions under developer review.

## 1. Architecture and planning

Example prompt:

> Act as a senior full-stack engineer. Review the Event Registration assignment requirements and propose a practical architecture using React, Express, Prisma, and MySQL. Identify the main entities, relationships, API boundaries, security requirements, and implementation order.

Purpose:
- Establish the overall application structure.
- Identify major backend and frontend responsibilities.
- Plan implementation in incremental milestones.

## 2. Database schema

Example prompt:

> Design a relational schema for an event registration system with organizers, check-in staff, events, sessions, registrations, registration lifecycle history, staff assignments, and capacity alerts. Explain primary keys, foreign keys, indexes, uniqueness constraints, and many-to-many relationships.

Purpose:
- Create the initial Prisma data model.
- Reason about relationships and constraints.
- Identify indexes required for common registration queries.

## 3. Authentication and authorization

Example prompt:

> Implement JWT authentication and server-side role-based authorization for an Express API with ORGANIZER and CHECKIN_STAFF roles. Ensure protected routes cannot rely on frontend role restrictions.

Purpose:
- Establish authentication middleware.
- Add role-based authorization.
- Keep security decisions on the backend.

## 4. Registration lifecycle

Example prompt:

> Design and implement a registration state machine with RESERVED, CONFIRMED, CHECKED_IN, CANCELLED, and EXPIRED states. Define legal transitions for organizers and check-in staff and return clear errors for invalid transitions.

Purpose:
- Make lifecycle rules explicit.
- Prevent illegal status changes.
- Support audit history.

## 5. Capacity and expiry

Example prompt:

> Implement session capacity enforcement where RESERVED, CONFIRMED, and CHECKED_IN registrations consume capacity. Prevent overselling, allow seats to become available after cancellation or expiry, and automatically expire temporary reservations.

Purpose:
- Implement capacity checks.
- Prevent registrations beyond capacity.
- Release seats when reservations expire.

## 6. Staff assignment

Example prompt:

> Implement many-to-many assignment between CHECKIN_STAFF users and sessions. Only organizers should assign or remove staff, while assigned staff should be able to view all of their assigned sessions and check in attendees.

Purpose:
- Implement StaffAssignment.
- Enforce organizer-only assignment.
- Enforce staff/session authorization during check-in.

## 7. Search, filtering and pagination

Example prompt:

> Add server-side registration search by attendee name/email, event/session/status filters, sorting, pagination, and total result counts. Keep filtering and pagination in the API rather than loading the entire dataset into React.

Purpose:
- Build scalable registration management.
- Provide predictable API responses.

## 8. CSV import/export

Example prompt:

> Implement CSV registration import with per-row CREATED, DUPLICATE, and REJECTED results. Invalid rows must not prevent valid rows from being imported. Also implement a filtered CSV export for the check-in sheet.

Purpose:
- Implement bulk registration workflows.
- Provide useful row-level validation feedback.

## 9. Dashboard and alerts

Example prompt:

> Implement an organizer dashboard showing today's sessions, today's check-ins, expired registrations this week, sessions at capacity, registration status breakdown, session breakdown, and check-ins over the last 14 days. Add dismissible capacity alerts that reappear only after a seat is freed and the session reaches capacity again.

Purpose:
- Implement operational reporting.
- Avoid repeatedly recreating dismissed alerts.

## 10. Debugging and validation

AI assistance was also used to reason through implementation errors and test failures, including:

- Prisma configuration and client generation.
- MySQL schema synchronization.
- React frontend data-shape mismatches.
- Dashboard response-shape issues.
- Staff session response nesting.
- Capacity alert recreation behavior.
- Security issues around public organizer registration.
- Removal of development-only test endpoints.

For each issue, the implementation was tested locally after the change rather than accepting generated code without verification.

## 11. Human review and final decisions

AI-generated suggestions were treated as development assistance rather than authoritative implementation.

Final decisions were based on:
- Assignment requirements.
- Actual application behavior.
- Local API testing.
- Database verification.
- Frontend production build.
- Security review.
- Practical implementation time.

The final code and documentation were reviewed against the assignment requirements before submission.
