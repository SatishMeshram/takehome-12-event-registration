# Event Registration — Submission

## Project

Event Registration take-home assignment for Busy Infotech.

## Links

**GitHub repository:** https://github.com/SatishMeshram/takehome-12-event-registration

**Live application:** TODO — add deployed URL after deployment.

## Notes for the reviewer

The application is a React + Express + MySQL event registration system.

The backend enforces authentication, role-based authorization, registration lifecycle rules, capacity protection, staff assignment permissions, and immutable registration history.

## Demo credentials

| Role | Email | Password |
|------|-------|----------|
| Organizer | organizer@test.com | Organizer@123 |
| Check-in Staff | staff@test.com | Staff@12345 |

## Implemented Features

- Organizer and check-in staff authentication.
- JWT authentication and server-side RBAC.
- Public registration restricted to check-in staff.
- Event create, edit, archive, and restore.
- Event venue support.
- Session create, edit, and delete.
- Registration lifecycle: RESERVED, CONFIRMED, CHECKED_IN, CANCELLED, EXPIRED.
- Automatic reservation expiry.
- Capacity protection and overselling prevention.
- Many-to-many staff/session assignment.
- Authorized staff check-in.
- Registration search, filters, sorting, and pagination.
- Immutable registration history.
- CSV registration import with per-row results.
- CSV check-in export.
- Organizer dashboard.
- Capacity alerts with dismissal and re-alert behavior.

## Validation

The application was tested locally through REST API testing, frontend testing, database inspection, and production frontend build validation.

Validated workflows include authentication, authorization, event/session management, registration lifecycle, capacity enforcement, automatic expiry, staff assignment, authorized check-in, registration search/filtering/pagination, CSV import/export, dashboard metrics, registration history, and capacity alert recreation.

## Technology Stack

- React
- Vite
- JavaScript
- CSS
- Node.js
- Express
- JWT
- bcrypt
- Multer
- Prisma ORM
- MySQL

## Documentation

- docs/architecture.md
- docs/schema.md
- docs/plan.md
- docs/decisions.md
- docs/ai-prompts.md

## Final Checklist

- GitHub repository pushed and publicly accessible.
- Frontend deployment completed.
- Backend deployment completed.
- Production database configured.
- Production authentication tested.
- Organizer workflow tested.
- Check-in staff workflow tested.
- No application secrets committed to source control.
- Final repository documentation completed.
