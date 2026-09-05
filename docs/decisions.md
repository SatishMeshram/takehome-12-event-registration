# Engineering Decisions

## 1. Keep the application as a monolith

I chose a conventional React + Express + MySQL architecture instead of microservices.

This keeps the assignment easier to develop, test, debug, and deploy within the available time. The application still has clear boundaries between the frontend, API, business rules, and persistence layer.

## 2. Keep authorization on the server

Frontend role-based UI is useful for user experience, but it is not treated as a security boundary.

Every protected operation is authorized by the Express API using the authenticated user's current database role. This prevents a user from bypassing frontend restrictions by calling the API directly.

## 3. Use JWT authentication with a database-backed user lookup

JWT is used to authenticate requests without maintaining server-side sessions.

After verifying the JWT, the API retrieves the current user from the database. This means authorization uses the current role stored in MySQL instead of trusting an old role value contained only in the token.

## 4. Restrict public registration to check-in staff

The public registration endpoint only permits CHECKIN_STAFF accounts.

Allowing public creation of ORGANIZER accounts would let an unauthenticated person obtain privileged access. Organizer accounts therefore need to be created through an authorized administrative process rather than the public signup flow.

## 5. Model registration as an explicit state machine

Registration lifecycle rules are implemented as explicit allowed transitions.

Organizer transitions:
- RESERVED ? CONFIRMED
- RESERVED ? CANCELLED
- CONFIRMED ? CANCELLED

Check-in staff transition:
- CONFIRMED ? CHECKED_IN

Reserved registrations can also become EXPIRED automatically.

Terminal states such as CHECKED_IN, CANCELLED, and EXPIRED cannot be changed through the normal status transition API.

This makes illegal transitions explicit and allows the API to return a clear explanation when a requested transition is not permitted.

## 6. Count only active lifecycle states toward capacity

Capacity is based on RESERVED, CONFIRMED, and CHECKED_IN registrations.

CANCELLED and EXPIRED registrations do not consume a seat.

This matches the business meaning of an occupied seat and prevents historical registrations from permanently reducing available capacity.

## 7. Validate capacity in application logic

Capacity depends on the current registration state and business workflow, so it is enforced by the API rather than represented as a simple database constraint.

The API checks occupied registrations before creating a new reservation and prevents session capacity from being reduced below the currently occupied count.

For higher concurrency in a larger production deployment, this logic would need stronger transactional locking or an atomic reservation mechanism.

## 8. Automatically expire temporary reservations

Reserved registrations have a holding window.

The backend periodically checks for expired reservations and changes them from RESERVED to EXPIRED while recording the lifecycle action in registration history.

This avoids requiring a user or administrator to manually release expired seats.

## 9. Use a join table for staff assignment

Staff assignment is many-to-many: one staff member can work multiple sessions and one session can have multiple staff members.

StaffAssignment is therefore used as an explicit join table.

A unique constraint on sessionId + userId prevents duplicate assignments.

## 10. Keep registration history append-only

RegistrationHistory is designed as an immutable audit trail.

Lifecycle actions create new history rows rather than editing previous history entries.

The application intentionally does not expose update or delete operations for history records.

This preserves who performed an action, what changed, and when it happened.

## 11. Keep current lifecycle timestamps on Registration

The schema remains mostly normalized, but important lifecycle timestamps are stored directly on Registration, including reservedAt, expiresAt, confirmedAt, checkedInAt, and cancelledAt.

This is a deliberate operational trade-off. Common registration-list and reporting queries can use the current registration record without repeatedly reconstructing timestamps from the history table.

RegistrationHistory remains the audit source for the sequence of actions.

## 12. Use server-side registration search and pagination

Search, filters, sorting, and pagination are implemented in the API.

This avoids loading the complete registration dataset into the browser and makes the response size predictable as the number of registrations increases.

The API also returns total matches and page information so the frontend can build a usable paginated interface.

## 13. Process CSV imports row by row

CSV import returns a result for every row.

Rows can be:
- CREATED
- DUPLICATE
- REJECTED with a reason

A bad row does not cause valid rows in the same file to be discarded.

This provides better operational feedback than treating the entire CSV as a single all-or-nothing operation.

## 14. Generate CSV export on the server

Check-in exports are generated by the API using the same server-side filtering concepts as the registration list.

This allows organizers and authorized staff to export the relevant dataset without requiring the frontend to reconstruct or filter the complete dataset itself.

## 15. Treat archived events as hidden, not deleted

Event archiving uses archivedAt rather than destroying the event.

Normal active-event queries exclude archived events, while organizers can access archived records and restore them.

This preserves registrations, sessions, assignments, and history associated with the event.

## 16. Use capacity alerts with dismissal-aware recreation

Capacity alerts are stored as database records instead of being calculated only in the frontend.

An organizer can dismiss an alert. The backend does not immediately recreate the same alert on every request.

A new alert is created only after a seat has actually been freed through cancellation or expiry and the session subsequently reaches capacity again.

This avoids noisy repeated alerts while still notifying the organizer about a new capacity event.

## 17. Use MySQL with Prisma

MySQL provides relational persistence and Prisma provides the application data-access layer.

Prisma models relationships, indexes, and constraints while the application handles business rules that depend on current state and authorization.

## 18. Preserve the existing migration history for the venue addition

The Event venue field was required by the assignment and was added to the existing MySQL Event table.

Because the column already existed in the database, I did not create and apply a second migration that would attempt to add the same column again.

The Prisma schema now represents the actual database structure, while the existing migration history remains unchanged.

This avoids creating a migration that would fail against the already-updated database.

## 19. Remove development-only API endpoints before finalization

Temporary endpoints used during development for creating test sessions or manually forcing registration expiry were removed from the final backend.

Automatic reservation expiry remains because it is part of the actual application behavior.

This reduces unnecessary attack surface and keeps the submitted API aligned with the intended production feature set.

## 20. Prefer simple scaling improvements before architectural complexity

If usage increased significantly, the first improvements would be database indexes and query optimization, followed by caching and background processing where measurement shows a bottleneck.

Large CSV imports could move to background jobs, dashboard aggregation could be cached or precomputed, and high-concurrency registration could use stronger transaction/locking strategies.

I would not introduce microservices until there was a demonstrated operational reason to do so.
